import mongoose from 'mongoose';
import Answer from '../models/Answer.js';
import Question from '../models/Question.js';
import Vote from '../models/Vote.js';
import User from '../models/User.js';
import { checkAnswer } from './groq.js';
import { promoteToCorpus } from './corpus.js';
import AppError from '../utils/appError.js';
import logger from '../utils/logger.js';

/**
 * Service managing community answers, relevance checks, scoring, and auto-promotions.
 */
class AnswerService {
  /**
   * Submit an answer to a community question.
   * Performs an AI relevance/safety check and increments counts.
   *
   * @param {Object} data - Answer submission inputs
   * @param {string} data.question_id - Question database ID
   * @param {string} data.content - Raw answer text (20 to 1000 characters)
   * @param {string} data.userId - Creator database ID
   * @returns {Promise<{success: boolean, status: string, answer_id: string, message: string}>}
   */
  async submit({ question_id, content, userId }) {
    if (!question_id || !content) {
      throw new AppError('question_id and content are required.', 400);
    }

    const cleanContent = content.trim();
    if (cleanContent.length < 20) {
      throw new AppError('Answer must be at least 20 characters.', 400);
    }

    if (cleanContent.length > 1000) {
      throw new AppError('Answer must not exceed 1000 characters.', 400);
    }

    // Verify question exists
    const question = await Question.findById(question_id);
    if (!question) {
      throw new AppError('Question not found.', 404);
    }

    // Rate-limit: max 3 answers per user per question
    const userAnswerCount = await Answer.countDocuments({
      question_id,
      answered_by: userId,
    });

    if (userAnswerCount >= 3) {
      throw new AppError('You can submit at most 3 answers to the same question.', 400);
    }

    // AI validation: check relevance + ethical guidelines
    const aiResult = await checkAnswer(question.rephrased_query, cleanContent);

    // Create answer
    const answer = await Answer.create({
      question_id,
      answered_by: userId,
      content: cleanContent,
      status: aiResult.passes ? 'live' : 'flagged',
      ai_check_passed: aiResult.passes,
      flag_reason: aiResult.flag_reason,
    });

    // Increment question stats
    const questionUpdate = { $inc: { answer_count: 1 } };
    
    if (aiResult.passes) {
      questionUpdate.status = 'answered';
      
      // Auto-upvote question if answered by another user
      if (question.posted_by.toString() !== userId.toString()) {
        questionUpdate.$inc.upvotes = 1;
        questionUpdate.$inc.net_score = 1;
      }
    }

    await Question.findByIdAndUpdate(question_id, questionUpdate);

    // Increment user's answer count (SP is manually managed by admins)
    await User.findByIdAndUpdate(userId, { $inc: { answers_count: 1 } });

    const message = aiResult.passes
      ? 'Your answer has been posted!'
      : 'Your answer has been sent for review.';

    return {
      success: true,
      status: answer.status,
      answer_id: answer._id,
      message,
    };
  }

  /**
   * Vote on a community answer.
   * Automatically handles auto-hiding (score <= -3) and corpus promotion (score >= 5).
   * Uses MongoDB transaction to ensure atomic vote creation and score update.
   *
   * @param {Object} data - Voting inputs
   * @param {string} data.id - Answer database ID
   * @param {string} data.type - Vote direction ('up' or 'down')
   * @param {string} data.userId - Creator database ID
   * @returns {Promise<{success: boolean, net_score: number, message: string}>}
   */
  async vote({ id, type, userId }) {
    if (!type || !['up', 'down'].includes(type)) {
      throw new AppError('Vote type must be "up" or "down".', 400);
    }

    const answer = await Answer.findById(id);
    if (!answer) {
      throw new AppError('Answer not found.', 404);
    }

    // Cannot vote on own answer
    if (answer.answered_by.toString() === userId.toString()) {
      throw new AppError('You cannot vote on your own answer.', 403);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create vote within transaction
      await Vote.create([{
        user_id: userId,
        answer_id: answer._id,
        type,
      }], { session });

      const update = type === 'up'
        ? { $inc: { upvotes: 1, net_score: 1 } }
        : { $inc: { downvotes: 1, net_score: -1 } };

      const updatedAnswer = await Answer.findByIdAndUpdate(
        answer._id,
        update,
        { new: true, session }
      );

      await session.commitTransaction();

      // Auto-hide answer at net score <= -3 (outside transaction - not critical)
      if (updatedAnswer.net_score <= -3 && updatedAnswer.status !== 'hidden') {
        await Answer.findByIdAndUpdate(answer._id, { status: 'hidden' });
      }

      // Automatically trigger Phase 5: promote to FAQ corpus at score >= 5 (async, non-critical)
      if (updatedAnswer.net_score >= 5 && updatedAnswer.ai_check_passed && !updatedAnswer.promoted_to_corpus) {
        promoteToCorpus(updatedAnswer).catch(err =>
          logger.warn('AnswerService', `Corpus auto-promotion failed: ${err.message}`)
        );
      }

      return {
        success: true,
        net_score: updatedAnswer.net_score,
        message: type === 'up' ? 'Upvoted!' : 'Downvoted.',
      };
    } catch (error) {
      await session.abortTransaction();

      // Handle duplicate vote error
      if (error.code === 11000) {
        throw new AppError('You have already voted on this answer.', 409);
      }
      throw error;
    } finally {
      session.endSession();
    }
  }
}

export default new AnswerService();
