CREATE TABLE `annotations` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`sentence_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`start` integer,
	`end` integer,
	`quote` text,
	`kind` text NOT NULL,
	`question` text,
	`body` text NOT NULL,
	`source` text NOT NULL,
	`model` text,
	`created_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `annotations_sentence_idx` ON `annotations` (`note_id`,`sentence_id`);--> statement-breakpoint
CREATE INDEX `annotations_chapter_idx` ON `annotations` (`note_id`,`chapter_id`);--> statement-breakpoint
CREATE TABLE `auth_challenges` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`challenge` text NOT NULL,
	`user_id` text,
	`data` text,
	`expires_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `auth_tokens` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`user_id` text,
	`grants_admin` integer DEFAULT false NOT NULL,
	`created_by` text,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	`used_at` text
);
--> statement-breakpoint
CREATE TABLE `books` (
	`id` integer PRIMARY KEY NOT NULL,
	`gutenberg_id` integer,
	`title` text NOT NULL,
	`author` text,
	`language` text,
	`source_url` text NOT NULL,
	`epub_key` text,
	`segmenter_version` text NOT NULL,
	`chapter_count` integer DEFAULT 0 NOT NULL,
	`sentence_count` integer DEFAULT 0 NOT NULL,
	`ingested_by` text,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `books_gutenberg_idx` ON `books` (`gutenberg_id`);--> statement-breakpoint
CREATE TABLE `chapters` (
	`id` integer PRIMARY KEY NOT NULL,
	`book_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`title` text NOT NULL,
	`sentence_count` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chapters_book_seq_idx` ON `chapters` (`book_id`,`seq`);--> statement-breakpoint
CREATE TABLE `concepts` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`chapter_id` integer,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `concepts_note_idx` ON `concepts` (`note_id`);--> statement-breakpoint
CREATE TABLE `gutenberg_works` (
	`text_id` integer PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`sort_key` text NOT NULL,
	`authors` text NOT NULL,
	`language` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `gutenberg_works_sort_idx` ON `gutenberg_works` (`language`,`sort_key`);--> statement-breakpoint
CREATE INDEX `gutenberg_works_authors_idx` ON `gutenberg_works` (`authors`);--> statement-breakpoint
CREATE TABLE `note_members` (
	`note_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`added_at` text NOT NULL,
	PRIMARY KEY(`note_id`, `user_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `note_members_user_idx` ON `note_members` (`user_id`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`book_id` integer NOT NULL,
	`title` text NOT NULL,
	`policy` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')) NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `notes_book_idx` ON `notes` (`book_id`);--> statement-breakpoint
CREATE TABLE `passkeys` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`public_key` text NOT NULL,
	`counter` integer DEFAULT 0 NOT NULL,
	`transports` text,
	`device_name` text,
	`created_at` text NOT NULL,
	`last_used_at` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `passkeys_user_idx` ON `passkeys` (`user_id`);--> statement-breakpoint
CREATE TABLE `sentences` (
	`id` integer PRIMARY KEY NOT NULL,
	`book_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`seq` integer NOT NULL,
	`para` integer NOT NULL,
	`kind` text NOT NULL,
	`text` text NOT NULL,
	FOREIGN KEY (`book_id`) REFERENCES `books`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sentences_chapter_idx` ON `sentences` (`chapter_id`,`seq`);--> statement-breakpoint
CREATE UNIQUE INDEX `sentences_book_seq_idx` ON `sentences` (`book_id`,`seq`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `terms` (
	`id` integer PRIMARY KEY NOT NULL,
	`note_id` text NOT NULL,
	`source` text NOT NULL,
	`target` text NOT NULL,
	`kind` text DEFAULT 'term' NOT NULL,
	`chapter_id` integer,
	`memo` text DEFAULT '' NOT NULL,
	`updated_by` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`chapter_id`) REFERENCES `chapters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `terms_note_idx` ON `terms` (`note_id`,`source`);--> statement-breakpoint
CREATE TABLE `translations` (
	`note_id` text NOT NULL,
	`sentence_id` integer NOT NULL,
	`chapter_id` integer NOT NULL,
	`text` text NOT NULL,
	`status` text NOT NULL,
	`rationale` text,
	`model` text,
	`updated_by` text,
	`updated_at` text NOT NULL,
	PRIMARY KEY(`note_id`, `sentence_id`),
	FOREIGN KEY (`note_id`) REFERENCES `notes`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentences`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `translations_chapter_idx` ON `translations` (`note_id`,`chapter_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`username` text NOT NULL,
	`is_admin` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_username_idx` ON `users` (`username`);