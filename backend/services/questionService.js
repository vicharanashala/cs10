import mongoose from 'mongoose';
import Question from '../models/Question.js';
import Answer from '../models/Answer.js';
import Vote from '../models/Vote.js';
import User from '../models/User.js';
import FAQ from '../models/FAQ.js';
import { rephraseQuery, classifyForPosting } from './groq.js';
import { getEmbedding } from './embeddingService.js';
import AppError from '../utils/appError.js';

/** Threshold in ms after which an open, unanswered question is spotlighted. */
const SPOTLIGHT_THRESHOLD_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Returns true when a question should be highlighted in the Community Spotlight.
 * Criteria: status is 'open', answer_count is 0, and posted more than 2 minutes ago.
 *
 * @param {Object} q - Question document (plain object or Mongoose doc)
 * @returns {boolean}
 */
const isSpotlighted = (q) => {
  return (
    q.status === 'open' &&
    (q.answer_count || 0) === 0 &&
    (Date.now() - new Date(q.created_at).getTime()) > SPOTLIGHT_THRESHOLD_MS
  );
};

/**
 * Service managing community questions, duplicate checking, and votes.
 */
class QuestionService {
  /**
   * Rephrase and categorize a raw query for posting.
   *
   * @param {string} query - Raw user query
   * @returns {Promise<{rephrased: string, category: string}>}
   */
  async prepare(query) {
    if (!query || typeof query !== 'string' || query.trim().length < 8) {
      throw new AppError('Please provide a valid query (at least 8 characters).', 400);
    }

    return rephraseQuery(query.trim());
  }

  /**
   * Submit a new question to the Q&A community board.
   * Performs semantic duplicate checks on FAQ and MongoDB.
   *
   * @param {Object} data - Submission payload
   * @param {string} data.original_query - Raw user query
   * @param {string} data.rephrased_query - Cleaned standalone question
   * @param {string} data.category - Section code
   * @param {string} data.userId - Creator database ID
   * @returns {Promise<{success: boolean, duplicate?: boolean, existing_question?: string, question_id?: string, message: string}>}
   */
  async submit({ original_query, rephrased_query, category, category_path, category_label, userId }) {
    if (!original_query || !rephrased_query) {
      throw new AppError('original_query and rephrased_query are required.', 400);
    }

    const rephrasedClean = rephrased_query.trim();

    // 1. Duplicate detection: check if a similar question exists in FAQ vector store
    try {
      const embedding = await getEmbedding(rephrasedClean);

      const dupCheck = await FAQ.aggregate([
        {
          $vectorSearch: {
            index: 'faq_vector_index',
            path: 'embedding',
            queryVector: embedding,
            numCandidates: 10,
            limit: 1
          }
        },
        {
          $project: {
            question: 1,
            similarity: { $meta: 'searchScore' }
          }
        }
      ]);

      if (dupCheck.length > 0 && dupCheck[0].similarity > 0.90) {
        return {
          success: false,
          duplicate: true,
          existing_question: dupCheck[0].question,
          message: 'A very similar question already exists in our FAQ database.',
        };
      }
    } catch (dupError) {
      console.error('⚠️ Duplicate check vector search failed:', dupError.message);
    }

    // 2. Check MongoDB for duplicate community questions
    const existingQuestion = await Question.findOne({
      rephrased_query: { $regex: new RegExp(`^${rephrasedClean.substring(0, 50)}`, 'i') },
      status: { $ne: 'closed' },
    });

    if (existingQuestion) {
      return {
        success: false,
        duplicate: true,
        question_id: existingQuestion._id,
        message: 'A similar question has already been posted to the community.',
      };
    }

    // 3. AI Moderation (2-Step Filter)
    const classification = await classifyForPosting(original_query);
    let status = 'open';
    if (classification.action === 'review') status = 'review';
    if (classification.action === 'hide') status = 'hidden';

    // 4. Use provided category_path or fallback to Groq categorization
    let finalCategoryPath  = category_path  || null;
    let finalCategoryLabel = category_label || null;
    if (!finalCategoryPath) {
      const { categorizeQuestion } = await import('./groq.js');
      const cat = await categorizeQuestion(rephrasedClean);
      finalCategoryPath  = cat.path;
      finalCategoryLabel = cat.label;
    }
    // Legacy slug-based category — map from path for backward compat
    const legacySlug = finalCategoryPath?.split('.')?.pop() || category || 'general';

    // 5. Create the question
    const question = await Question.create({
      original_query:  original_query.trim(),
      rephrased_query: rephrasedClean,
      category:        legacySlug,
      category_path:   finalCategoryPath,
      category_label:  finalCategoryLabel,
      posted_by:       userId,
      status,
    });

    // 4. Increment user's question count
    await User.findByIdAndUpdate(userId, { $inc: { questions_count: 1 } });

    return {
      success: true,
      question_id: question._id,
      message: "Your question has been posted! You'll be notified when someone answers.",
    };
  }

  /**
   * Fetch paginated list of community questions.
   *
   * @param {Object} queryOptions - Filters and paging values
   * @returns {Promise<{data: Array, total: number, page: number, pages: number}>}
   */
  async list({ category, category_path, status = 'open', page = 1, sort = 'newest', limit = 20, search } = {}) {
    const pageNum  = Math.max(1, parseInt(page));
    const limitNum = Math.min(100, Math.max(1, parseInt(limit))); // 100 allows full spotlight fetch
    const skip     = (pageNum - 1) * limitNum;

    const filter = {};
    // Prefer category_path (DB-based) filter; fall back to legacy slug-based category
    if (category_path) {
      filter.category_path = category_path;
    } else if (category) {
      filter.category = category.toLowerCase();
    }
    if (status && status !== 'all') filter.status = status;
    // Full-text search across rephrased and original query fields
    if (search && search.trim()) {
      const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [
        { rephrased_query: rx },
        { original_query:  rx },
      ];
    }

    const sortOptions = {};
    switch (sort) {
      case 'oldest': sortOptions.created_at = 1; break;
      case 'most_answers': sortOptions.answer_count = -1; break;
      case 'most_viewed': sortOptions.view_count = -1; break;
      case 'most_voted': sortOptions.net_score = -1; break;
      case 'hybrid': break; // Handled separately
      default: sortOptions.created_at = -1; // newest
    }

    if (sort === 'hybrid') {
      const pipeline = [
        { $match: filter },
        {
          $addFields: {
            ageInDays: { $divide: [{ $subtract: [new Date(), "$created_at"] }, 1000 * 60 * 60 * 24] },
            priorityScore: { $ifNull: ["$priority", 0] },
            searchScore: { $ifNull: ["$search_frequency", 0] },
            engagementScore: { $ifNull: ["$engagement_time", 0] },
            baseNet: { $ifNull: ["$net_score", 0] }
          }
        },
        {
          $addFields: {
            // max 10 points for recency, drops off by 1 point each day
            recencyScore: { $max: [0, { $subtract: [10, "$ageInDays"] }] }
          }
        },
        {
          $addFields: {
            // Final Score = (Upvotes × 0.4) + (Search Frequency × 0.2) + (Recency × 0.15) + (Admin Priority × 0.15) + (User Engagement Time × 0.1)
            // Note: Since engagement time is in seconds and can be huge, we cap it at 300 seconds for scoring purposes to avoid it dominating the score.
            cappedEngagement: { $min: ["$engagementScore", 300] },
            hybrid_score: {
              $add: [
                { $multiply: ["$baseNet", 0.4] },
                { $multiply: ["$searchScore", 0.2] },
                { $multiply: ["$recencyScore", 0.15] },
                { $multiply: ["$priorityScore", 0.15] },
                { $multiply: ["$cappedEngagement", 0.1] }
              ]
            }
          }
        },
        { $sort: { hybrid_score: -1, created_at: -1 } },
        { $skip: skip },
        { $limit: limitNum }
      ];

      const [questions, total] = await Promise.all([
        Question.aggregate(pipeline),
        Question.countDocuments(filter),
      ]);

      await User.populate(questions, { path: 'posted_by', select: 'name' });

      // Attach spotlight flag and sort: pinned → spotlighted → regular
      const spotlightCutoff = new Date(Date.now() - SPOTLIGHT_THRESHOLD_MS);
      const withSpotlight = questions.map((q) => ({ ...q, is_spotlighted: isSpotlighted(q) }));
      const pinned      = withSpotlight.filter((q) => q.is_pinned);
      const spotlighted = withSpotlight.filter((q) => !q.is_pinned && q.is_spotlighted);
      const regular     = withSpotlight.filter((q) => !q.is_pinned && !q.is_spotlighted);

      // spotlightTotal = full DB count of spotlighted questions (not page-relative)
      const spotlightTotal = await Question.countDocuments({
        status: 'open',
        answer_count: 0,
        created_at: { $lt: spotlightCutoff },
      });

      return {
        data: [...pinned, ...spotlighted, ...regular],
        total,
        spotlightTotal,
        page: pageNum,
        pages: Math.ceil(total / limitNum),
      };
    }

    const [questions, total] = await Promise.all([
      Question.find(filter)
        .populate('posted_by', 'name')
        .sort(sortOptions)
        .skip(skip)
        .limit(limitNum)
        .lean(),
      Question.countDocuments(filter),
    ]);

    // Attach spotlight flag and sort: pinned → spotlighted → regular
    const spotlightCutoff = new Date(Date.now() - SPOTLIGHT_THRESHOLD_MS);
    const withSpotlight = questions.map((q) => ({ ...q, is_spotlighted: isSpotlighted(q) }));
    const pinned      = withSpotlight.filter((q) => q.is_pinned);
    const spotlighted = withSpotlight.filter((q) => !q.is_pinned && q.is_spotlighted);
    const regular     = withSpotlight.filter((q) => !q.is_pinned && !q.is_spotlighted);

    // spotlightTotal = full DB count of spotlighted questions (not page-relative)
    const spotlightTotal = await Question.countDocuments({
      status: 'open',
      answer_count: 0,
      created_at: { $lt: spotlightCutoff },
    });

    return {
      data: [...pinned, ...spotlighted, ...regular],
      total,
      spotlightTotal,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
    };
  }

  /**
   * Get detail information for a single question (includes incrementing view counter).
   *
   * @param {string} id - Question ID
   * @returns {Promise<{question: Object, answers: Array, hidden_count: number}>}
   */
  async get(id) {
    const question = await Question.findById(id).populate('posted_by', 'name');
    if (!question) {
      throw new AppError('Question not found.', 404);
    }

    // Increment view count
    await Question.findByIdAndUpdate(id, { $inc: { view_count: 1 } });

    const answers = await Answer.find({
      question_id: id,
      status: { $in: ['live', 'flagged'] },
    })
      .populate('answered_by', 'name xp')
      .sort({ net_score: -1, created_at: -1, status: 1 })
      .lean();

    const hiddenCount = await Answer.countDocuments({
      question_id: id,
      status: 'hidden',
    });

    return {
      question,
      answers,
      hidden_count: hiddenCount,
    };
  }

  /**
   * Vote on a community question.
   * Uses MongoDB transaction to ensure atomic vote creation and score update.
   *
   * @param {Object} data - Voting details
   * @param {string} data.id - Question database ID
   * @param {string} data.type - Vote type ('up' or 'down')
   * @param {string} data.userId - Database ID of voter user
   * @returns {Promise<{success: boolean, net_score: number, message: string}>}
   */
  async vote({ id, type, userId }) {
    if (!type || !['up', 'down'].includes(type)) {
      throw new AppError('Vote type must be "up" or "down".', 400);
    }

    const question = await Question.findById(id);
    if (!question) {
      throw new AppError('Question not found.', 404);
    }

    // Cannot vote on own question
    if (question.posted_by.toString() === userId.toString()) {
      throw new AppError('You cannot vote on your own question.', 403);
    }

    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // Create vote within transaction
      await Vote.create([{
        user_id: userId,
        question_id: question._id,
        type,
      }], { session });

      const update = type === 'up'
        ? { $inc: { upvotes: 1, net_score: 1 } }
        : { $inc: { downvotes: 1, net_score: -1 } };

      const updatedQuestion = await Question.findByIdAndUpdate(
        question._id,
        update,
        { new: true, session }
      );

      await session.commitTransaction();

      return {
        success: true,
        net_score: updatedQuestion.net_score,
        message: 'Vote recorded',
      };
    } catch (error) {
      await session.abortTransaction();

      // Handle duplicate vote error
      if (error.code === 11000) {
        throw new AppError('You have already voted on this question.', 409);
      }
      throw error;
    } finally {
      session.endSession();
    }
  }

  /**
   * Increments the engagement time for a question
   */
  async addEngagementTime(id, timeSeconds) {
    await Question.findByIdAndUpdate(id, { $inc: { engagement_time: timeSeconds } });
  }

  /**
   * Increments the search frequency hit for a question
   */
  async addSearchHit(id) {
    await Question.findByIdAndUpdate(id, { $inc: { search_frequency: 1 } });
  }
}

export default new QuestionService();
