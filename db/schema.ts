import { sqliteTable, text, integer, real, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const roomState = sqliteTable('room_state', {
  id: integer('id').primaryKey(),
  data: text('data').notNull(),
  revision: integer('revision').notNull().default(0),
  updatedAt: integer('updated_at').notNull(),
});

export const members = sqliteTable('members', {
  userId: text('user_id').primaryKey(),
  slot: integer('slot').notNull(),
  displayName: text('display_name').notNull(),
  lastSeen: integer('last_seen').notNull(),
}, table => [uniqueIndex('members_slot_unique').on(table.slot)]);

export const homeEvents = sqliteTable('home_events', {
  id: text('id').primaryKey(),
  revision: integer('revision').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const photos = sqliteTable('photos', {
  id: text('id').primaryKey(),
  objectKey: text('object_key').notNull(),
  caption: text('caption').notNull(),
  createdAt: integer('created_at').notNull(),
  userId: text('user_id').notNull(),
});

export const travelFootprints = sqliteTable('travel_footprints', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  cityName: text('city_name').notNull(),
  name: text('name').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  photos: text('photos').notNull(),
  visitDate: text('visit_date').notNull(),
  note: text('note').notNull(),
  color: text('color').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const truthDareGames = sqliteTable('truth_dare_games', {
  id: text('id').primaryKey(),
  creatorId: text('creator_id').notNull(),
  partnerId: text('partner_id').notNull(),
  p1Roll: integer('p1_roll'),
  p2Roll: integer('p2_roll'),
  status: text('status').notNull(),
  loserId: text('loser_id'),
  choiceType: text('choice_type'),
  questionText: text('question_text'),
  answerText: text('answer_text'),
  chatMessages: text('chat_messages').notNull().default('[]'),
  todoCreatedAt: integer('todo_created_at'),
  todoCompletedAt: integer('todo_completed_at'),
  createdAt: integer('created_at').notNull(),
}, table => [uniqueIndex('truth_dare_games_one_active_idx')
  .on(sql`(1)`).where(sql`${table.status} <> 'finished'`)]);

export const photoAi = sqliteTable('photo_ai', {
  photoId: text('photo_id').primaryKey().references(() => photos.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  tags: text('tags').notNull(),
  category: text('category').notNull(),
  embedding: text('embedding').notNull(),
  embeddingModel: text('embedding_model').notNull(),
  updatedAt: integer('updated_at').notNull(),
});

export const photoAiJobs = sqliteTable('photo_ai_jobs', {
  photoId: text('photo_id').primaryKey().references(() => photos.id, { onDelete: 'cascade' }),
  expiresAt: integer('expires_at').notNull(),
});

export const homeKeys = sqliteTable('home_keys', {
  slot: integer('slot').primaryKey(),
  keyHash: text('key_hash').notNull(),
  userId: text('user_id').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const homeSessions = sqliteTable('home_sessions', {
  tokenHash: text('token_hash').primaryKey(),
  keyHash: text('key_hash').notNull(),
  userId: text('user_id').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const authAttempts = sqliteTable('auth_attempts', {
  ipHash: text('ip_hash').primaryKey(),
  count: integer('count').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const memberPasswords = sqliteTable('member_passwords', {
  slot: integer('slot').primaryKey(),
  userId: text('user_id').notNull(),
  salt: text('salt').notNull(),
  passwordHash: text('password_hash').notNull(),
  version: text('version').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const recoveryCodes = sqliteTable('recovery_codes', {
  slot: integer('slot').primaryKey(),
  codeHash: text('code_hash').notNull(),
  createdAt: integer('created_at').notNull(),
});

export const videos = sqliteTable('videos', {
  id: text('id').primaryKey(),
  objectKey: text('object_key').notNull(),
  caption: text('caption').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  createdAt: integer('created_at').notNull(),
  userId: text('user_id').notNull(),
  ownerSlot: integer('owner_slot').notNull(),
  status: text('status').notNull(),
}, table => [uniqueIndex('videos_object_key_unique').on(table.objectKey)]);
