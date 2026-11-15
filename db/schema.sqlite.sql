-- Flarum 数据库结构（SQLite）
-- 仅结构，不含任何数据（用户/帖子/附件均不在内）
-- 表/索引/视图 共 82 项

-- [table] access_tokens
CREATE TABLE "access_tokens" ("id" integer primary key autoincrement not null, "token" varchar not null, "user_id" integer not null, "last_activity_at" datetime, "created_at" datetime not null, "type" varchar, "title" varchar, "last_ip_address" varchar, "last_user_agent" varchar, foreign key("user_id") references "users"("id") on delete cascade);

-- [table] api_keys
CREATE TABLE "api_keys" ("key" varchar not null, "id" integer primary key autoincrement not null, "allowed_ips" varchar, "scopes" varchar, "user_id" integer, "created_at" datetime not null, "last_activity_at" datetime, foreign key("user_id") references "users"("id") on delete cascade);

-- [table] audit_log
CREATE TABLE "audit_log" ("id" integer primary key autoincrement not null, "actor_id" integer, "client" varchar not null, "ip_address" varchar, "action" varchar not null, "payload" text, "created_at" datetime not null);

-- [table] dialog_message_mentions_group
CREATE TABLE "dialog_message_mentions_group" ("dialog_message_id" integer not null, "mentions_group_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("dialog_message_id") references "dialog_messages"("id") on delete cascade, foreign key("mentions_group_id") references "groups"("id") on delete cascade, primary key ("dialog_message_id", "mentions_group_id"));

-- [table] dialog_message_mentions_post
CREATE TABLE "dialog_message_mentions_post" ("dialog_message_id" integer not null, "mentions_post_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("dialog_message_id") references "dialog_messages"("id") on delete cascade, foreign key("mentions_post_id") references "posts"("id") on delete cascade, primary key ("dialog_message_id", "mentions_post_id"));

-- [table] dialog_message_mentions_tag
CREATE TABLE "dialog_message_mentions_tag" ("dialog_message_id" integer not null, "mentions_tag_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("dialog_message_id") references "dialog_messages"("id") on delete cascade, foreign key("mentions_tag_id") references "tags"("id") on delete cascade, primary key ("dialog_message_id", "mentions_tag_id"));

-- [table] dialog_message_mentions_user
CREATE TABLE "dialog_message_mentions_user" ("dialog_message_id" integer not null, "mentions_user_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("dialog_message_id") references "dialog_messages"("id") on delete cascade, foreign key("mentions_user_id") references "users"("id") on delete cascade, primary key ("dialog_message_id", "mentions_user_id"));

-- [table] dialog_messages
CREATE TABLE "dialog_messages" ("id" integer primary key autoincrement not null, "dialog_id" integer not null, "user_id" integer, "content" text not null, "created_at" datetime, "updated_at" datetime, "number" integer not null, foreign key("user_id") references users("id") on delete cascade on update no action, foreign key("dialog_id") references dialogs("id") on delete cascade on update no action);

-- [table] dialog_user
CREATE TABLE "dialog_user" ("id" integer primary key autoincrement not null, "dialog_id" integer not null, "user_id" integer not null, "joined_at" datetime not null, "last_read_message_id" integer not null default '0', "last_read_at" datetime, foreign key("dialog_id") references "dialogs"("id") on delete cascade, foreign key("user_id") references "users"("id") on delete cascade);

-- [table] dialogs
CREATE TABLE "dialogs" ("id" integer primary key autoincrement not null, "first_message_id" integer, "last_message_id" integer, "last_message_at" datetime, "last_message_user_id" integer, "type" varchar not null, "created_at" datetime, "updated_at" datetime, foreign key("last_message_user_id") references users("id") on delete set null on update no action, foreign key("first_message_id") references "dialog_messages"("id") on delete set null, foreign key("last_message_id") references "dialog_messages"("id") on delete set null);

-- [table] discussion_tag
CREATE TABLE "discussion_tag" ("discussion_id" integer not null, "tag_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("tag_id") references tags("id") on delete cascade on update no action, foreign key("discussion_id") references discussions("id") on delete cascade on update no action, primary key ("discussion_id", "tag_id"));

-- [table] discussion_user
CREATE TABLE discussion_user (user_id INTEGER NOT NULL, discussion_id INTEGER NOT NULL, last_read_at DATETIME DEFAULT NULL, last_read_post_number INTEGER DEFAULT NULL, "subscription" varchar check ("subscription" in ('follow', 'ignore')), PRIMARY KEY(user_id, discussion_id));

-- [table] discussions
CREATE TABLE discussions (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, title VARCHAR(255) NOT NULL COLLATE "BINARY", comment_count INTEGER DEFAULT 1 NOT NULL, participant_count INTEGER DEFAULT 0 NOT NULL, created_at DATETIME NOT NULL, user_id INTEGER DEFAULT NULL, first_post_id INTEGER DEFAULT NULL, last_posted_at DATETIME DEFAULT NULL, last_posted_user_id INTEGER DEFAULT NULL, last_post_id INTEGER DEFAULT NULL, last_post_number INTEGER DEFAULT NULL, hidden_at DATETIME DEFAULT NULL, hidden_user_id INTEGER DEFAULT NULL, slug VARCHAR(255) NOT NULL COLLATE "BINARY", is_private BOOLEAN DEFAULT 0 NOT NULL, "is_approved" tinyint(1) not null default '1', "is_sticky" tinyint(1) not null default '0', "is_locked" tinyint(1) not null default '0',     foreign key("user_id") references "users"("id") on delete set null,
    foreign key("last_posted_user_id") references "users"("id") on delete set null,
    foreign key("hidden_user_id") references "users"("id") on delete set null,
    foreign key("first_post_id") references "posts"("id") on delete set null,
    foreign key("last_post_id") references "posts"("id") on delete set null);

-- [table] email_tokens
CREATE TABLE "email_tokens" ("token" varchar(255) not null, "email" varchar not null, "user_id" integer not null, "created_at" datetime not null, primary key ("token"));

-- [table] flags
CREATE TABLE "flags" ("id" integer primary key autoincrement not null, "post_id" integer not null, "type" varchar not null, "user_id" integer, "reason" varchar, "reason_detail" text, "created_at" datetime not null, foreign key("user_id") references users("id") on delete cascade on update no action, foreign key("post_id") references posts("id") on delete cascade on update no action);

-- [table] gdpr_erasure
CREATE TABLE "gdpr_erasure" ("id" integer primary key autoincrement not null, "user_id" integer, "verification_token" varchar, "status" varchar, "reason" text, "created_at" datetime not null, "user_confirmed_at" datetime, "processed_by" integer, "processor_comment" text, "processed_at" datetime, "processed_mode" varchar, "cancelled_at" datetime, "confirmation_ip" varchar, foreign key("user_id") references users("id") on delete set null on update no action, foreign key("processed_by") references users("id") on delete no action on update no action);

-- [table] gdpr_exports
CREATE TABLE "gdpr_exports" ("id" integer primary key autoincrement not null, "user_id" integer, "actor_id" integer, "file" varchar, "created_at" datetime not null, "destroys_at" datetime not null, "downloaded_at" datetime, "downloaded_ip" varchar, "downloaded_user_agent" varchar, foreign key("actor_id") references "users"("id") on delete set null, foreign key("user_id") references "users"("id") on delete set null);

-- [table] group_permission
CREATE TABLE "group_permission" ("group_id" integer not null, "permission" varchar not null, "created_at" datetime, primary key ("group_id", "permission"));

-- [table] group_user
CREATE TABLE "group_user" ("user_id" integer not null, "group_id" integer not null, "created_at" datetime, primary key ("user_id", "group_id"));

-- [table] groups
CREATE TABLE "groups" ("id" integer primary key autoincrement not null, "name_singular" varchar not null, "name_plural" varchar not null, "color" varchar, "icon" varchar, "is_hidden" tinyint(1) not null default '0', "created_at" datetime, "updated_at" datetime, "position" integer);

-- [table] login_providers
CREATE TABLE "login_providers" ("id" integer primary key autoincrement not null, "user_id" integer not null, "provider" varchar not null, "identifier" varchar not null, "created_at" datetime, "last_login_at" datetime, foreign key("user_id") references "users"("id") on delete cascade);

-- [table] migrations
CREATE TABLE "migrations" ("id" integer primary key autoincrement not null, "migration" varchar not null, "extension" varchar);

-- [table] notifications
CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, user_id INTEGER NOT NULL, from_user_id INTEGER DEFAULT NULL, type VARCHAR(255) NOT NULL COLLATE "BINARY", subject_id INTEGER DEFAULT NULL, created_at DATETIME NOT NULL, is_deleted BOOLEAN DEFAULT 0 NOT NULL, read_at DATETIME DEFAULT NULL, "data" text);

-- [table] password_tokens
CREATE TABLE password_tokens (token VARCHAR(255) NOT NULL, user_id INTEGER NOT NULL, created_at DATETIME NOT NULL, PRIMARY KEY(token));

-- [table] post_likes
CREATE TABLE "post_likes" ("post_id" integer not null, "user_id" integer not null, "created_at" datetime not null default CURRENT_TIMESTAMP, foreign key("post_id") references "posts"("id") on delete cascade, foreign key("user_id") references "users"("id") on delete cascade, primary key ("post_id", "user_id"));

-- [table] post_mentions_group
CREATE TABLE "post_mentions_group" ("post_id" integer not null, "mentions_group_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("post_id") references "posts"("id") on delete cascade, foreign key("mentions_group_id") references "groups"("id") on delete cascade, primary key ("post_id", "mentions_group_id"));

-- [table] post_mentions_post
CREATE TABLE "post_mentions_post" ("post_id" integer not null, "mentions_post_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("mentions_post_id") references posts("id") on delete cascade on update no action, foreign key("post_id") references posts("id") on delete cascade on update no action, primary key ("post_id", "mentions_post_id"));

-- [table] post_mentions_tag
CREATE TABLE "post_mentions_tag" ("post_id" integer not null, "mentions_tag_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("post_id") references "posts"("id") on delete cascade, foreign key("mentions_tag_id") references "tags"("id") on delete cascade, primary key ("post_id", "mentions_tag_id"));

-- [table] post_mentions_user
CREATE TABLE "post_mentions_user" ("post_id" integer not null, "mentions_user_id" integer not null, "created_at" datetime default CURRENT_TIMESTAMP, foreign key("mentions_user_id") references users("id") on delete cascade on update no action, foreign key("post_id") references posts("id") on delete cascade on update no action, primary key ("post_id", "mentions_user_id"));

-- [table] post_user
CREATE TABLE "post_user" ("post_id" integer not null, "user_id" integer not null, foreign key("post_id") references "posts"("id") on delete cascade, foreign key("user_id") references "users"("id") on delete cascade, primary key ("post_id", "user_id"));

-- [table] posts
CREATE TABLE posts (id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL, discussion_id INTEGER NOT NULL, number INTEGER DEFAULT NULL, created_at DATETIME NOT NULL, user_id INTEGER DEFAULT NULL, type VARCHAR(255) DEFAULT NULL, content CLOB DEFAULT NULL -- 
, edited_at DATETIME DEFAULT NULL, edited_user_id INTEGER DEFAULT NULL, hidden_at DATETIME DEFAULT NULL, hidden_user_id INTEGER DEFAULT NULL, ip_address VARCHAR(255) DEFAULT NULL, is_private BOOLEAN DEFAULT 0 NOT NULL, "is_approved" tinyint(1) not null default '1',     foreign key("discussion_id") references "discussions"("id") on delete cascade,
    foreign key("user_id") references "users"("id") on delete set null,
    foreign key("edited_user_id") references "users"("id") on delete set null,
    foreign key("hidden_user_id") references "users"("id") on delete set null);

-- [table] queue_failed_jobs
CREATE TABLE "queue_failed_jobs" ("id" integer primary key autoincrement not null, "uuid" varchar not null, "connection" text, "queue" text not null, "payload" text not null, "exception" text not null, "failed_at" datetime not null default CURRENT_TIMESTAMP);

-- [table] queue_jobs
CREATE TABLE "queue_jobs" ("id" integer primary key autoincrement not null, "queue" varchar not null, "payload" text not null, "attempts" integer not null, "reserved_at" integer, "available_at" integer not null, "created_at" integer not null);

-- [table] registration_tokens
CREATE TABLE registration_tokens (token VARCHAR(255) NOT NULL, payload CLOB DEFAULT NULL, created_at DATETIME NOT NULL, "provider" varchar not null, "identifier" varchar not null, "user_attributes" text, PRIMARY KEY(token));

-- [table] settings
CREATE TABLE settings ("key" VARCHAR(255) NOT NULL, value CLOB DEFAULT NULL, PRIMARY KEY("key"));

-- [table] tag_user
CREATE TABLE "tag_user" ("user_id" integer not null, "tag_id" integer not null, "marked_as_read_at" datetime, "is_hidden" tinyint(1) not null default ('0'), foreign key("tag_id") references "tags"("id") on delete cascade, foreign key("user_id") references "users"("id") on delete cascade, primary key ("user_id", "tag_id"));

-- [table] tags
CREATE TABLE "tags" ("id" integer primary key autoincrement not null, "name" varchar not null, "slug" varchar not null, "description" text, "color" varchar, "position" integer, "parent_id" integer, "default_sort" varchar, "is_restricted" tinyint(1) not null default ('0'), "is_hidden" tinyint(1) not null default ('0'), "discussion_count" integer not null default ('0'), "last_posted_at" datetime, "last_posted_discussion_id" integer, "last_posted_user_id" integer, "icon" varchar, "created_at" datetime default CURRENT_TIMESTAMP, "updated_at" datetime default CURRENT_TIMESTAMP, "is_primary" tinyint(1) not null default '0', foreign key("last_posted_discussion_id") references discussions("id") on delete set null on update no action, foreign key("last_posted_user_id") references users("id") on delete set null on update no action, foreign key("parent_id") references tags("id") on delete set null on update no action);

-- [table] unsubscribe_tokens
CREATE TABLE "unsubscribe_tokens" ("id" integer primary key autoincrement not null, "user_id" integer not null, "email_type" varchar not null, "token" varchar not null, "unsubscribed_at" datetime, "created_at" datetime, "updated_at" datetime, foreign key("user_id") references "users"("id") on delete cascade);

-- [table] users
CREATE TABLE "users" ("id" integer primary key autoincrement not null, "username" varchar(255) not null collate 'binary', "email" varchar not null, "is_email_confirmed" boolean not null default (0) collate 'binary', "password" varchar(255) not null collate 'binary', "avatar_url" varchar(255) default (NULL), "joined_at" datetime default (NULL), "last_seen_at" datetime default (NULL), "marked_all_as_read_at" datetime default (NULL), "read_notifications_at" datetime default (NULL), "discussion_count" integer not null default (0), "comment_count" integer not null default (0), "preferences" text, "has_avatar_2x" tinyint(1) not null default ('0'), "has_avatar_3x" tinyint(1) not null default ('0'), "read_flags_at" datetime, "suspended_until" datetime, "suspend_reason" text, "suspend_message" text, "nickname" varchar, "anonymized" tinyint(1) not null default '0');

-- [index] access_tokens_token_unique
CREATE UNIQUE INDEX "access_tokens_token_unique" on "access_tokens" ("token");

-- [index] access_tokens_type_index
CREATE INDEX "access_tokens_type_index" on "access_tokens" ("type");

-- [index] api_keys_key_unique
CREATE UNIQUE INDEX "api_keys_key_unique" on "api_keys" ("key");

-- [index] audit_log_action_index
CREATE INDEX "audit_log_action_index" on "audit_log" ("action");

-- [index] audit_log_actor_id_index
CREATE INDEX "audit_log_actor_id_index" on "audit_log" ("actor_id");

-- [index] audit_log_client_index
CREATE INDEX "audit_log_client_index" on "audit_log" ("client");

-- [index] audit_log_ip_address_index
CREATE INDEX "audit_log_ip_address_index" on "audit_log" ("ip_address");

-- [index] discussions_comment_count_index
CREATE INDEX discussions_comment_count_index ON discussions (comment_count);

-- [index] discussions_created_at_index
CREATE INDEX discussions_created_at_index ON discussions (created_at);

-- [index] discussions_hidden_at_index
CREATE INDEX discussions_hidden_at_index ON discussions (hidden_at);

-- [index] discussions_is_locked_index
CREATE INDEX "discussions_is_locked_index" on "discussions" ("is_locked");

-- [index] discussions_is_sticky_created_at_index
CREATE INDEX "discussions_is_sticky_created_at_index" on "discussions" ("is_sticky", "created_at");

-- [index] discussions_is_sticky_last_posted_at_index
CREATE INDEX "discussions_is_sticky_last_posted_at_index" on "discussions" ("is_sticky", "last_posted_at");

-- [index] discussions_last_posted_at_index
CREATE INDEX discussions_last_posted_at_index ON discussions (last_posted_at);

-- [index] discussions_last_posted_user_id_index
CREATE INDEX discussions_last_posted_user_id_index ON discussions (last_posted_user_id);

-- [index] discussions_participant_count_index
CREATE INDEX discussions_participant_count_index ON discussions (participant_count);

-- [index] discussions_user_id_index
CREATE INDEX discussions_user_id_index ON discussions (user_id);

-- [index] flags_created_at_index
CREATE INDEX "flags_created_at_index" on "flags" ("created_at");

-- [index] gdpr_erasure_user_id_unique
CREATE UNIQUE INDEX "gdpr_erasure_user_id_unique" on "gdpr_erasure" ("user_id");

-- [index] login_providers_provider_identifier_unique
CREATE UNIQUE INDEX "login_providers_provider_identifier_unique" on "login_providers" ("provider", "identifier");

-- [index] notifications_user_id_index
CREATE INDEX "notifications_user_id_index" on "notifications" ("user_id");

-- [index] notifications_user_unread_type_index
CREATE INDEX "notifications_user_unread_type_index" on "notifications" ("user_id", "is_deleted", "read_at", "type");

-- [index] posts_discussion_id_created_at_index
CREATE INDEX posts_discussion_id_created_at_index ON posts (discussion_id, created_at);

-- [index] posts_discussion_id_number_index
CREATE INDEX posts_discussion_id_number_index ON posts (discussion_id, number);

-- [index] posts_discussion_id_number_unique
CREATE UNIQUE INDEX posts_discussion_id_number_unique ON posts (discussion_id, number);

-- [index] posts_type_created_at_index
CREATE INDEX "posts_type_created_at_index" on "posts" ("type", "created_at");

-- [index] posts_type_index
CREATE INDEX "posts_type_index" on "posts" ("type");

-- [index] posts_user_id_created_at_index
CREATE INDEX posts_user_id_created_at_index ON posts (user_id, created_at);

-- [index] queue_failed_jobs_uuid_unique
CREATE UNIQUE INDEX "queue_failed_jobs_uuid_unique" on "queue_failed_jobs" ("uuid");

-- [index] queue_jobs_queue_index
CREATE INDEX "queue_jobs_queue_index" on "queue_jobs" ("queue");

-- [index] tags_slug_unique
CREATE UNIQUE INDEX "tags_slug_unique" on "tags" ("slug");

-- [index] unsubscribe_tokens_email_type_index
CREATE INDEX "unsubscribe_tokens_email_type_index" on "unsubscribe_tokens" ("email_type");

-- [index] unsubscribe_tokens_token_index
CREATE INDEX "unsubscribe_tokens_token_index" on "unsubscribe_tokens" ("token");

-- [index] unsubscribe_tokens_token_unique
CREATE UNIQUE INDEX "unsubscribe_tokens_token_unique" on "unsubscribe_tokens" ("token");

-- [index] unsubscribe_tokens_user_id_email_type_index
CREATE INDEX "unsubscribe_tokens_user_id_email_type_index" on "unsubscribe_tokens" ("user_id", "email_type");

-- [index] unsubscribe_tokens_user_id_index
CREATE INDEX "unsubscribe_tokens_user_id_index" on "unsubscribe_tokens" ("user_id");

-- [index] users_comment_count_index
CREATE INDEX "users_comment_count_index" on "users" ("comment_count");

-- [index] users_discussion_count_index
CREATE INDEX "users_discussion_count_index" on "users" ("discussion_count");

-- [index] users_email_unique
CREATE UNIQUE INDEX "users_email_unique" on "users" ("email");

-- [index] users_joined_at_index
CREATE INDEX "users_joined_at_index" on "users" ("joined_at");

-- [index] users_last_seen_at_index
CREATE INDEX "users_last_seen_at_index" on "users" ("last_seen_at");

-- [index] users_nickname_index
CREATE INDEX "users_nickname_index" on "users" ("nickname");

-- [index] users_username_unique
CREATE UNIQUE INDEX "users_username_unique" on "users" ("username");
