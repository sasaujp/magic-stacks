-- The catalog is rebuilt from pg_catalog.csv; clear the old rows (they lack the new keys).
DELETE FROM `gutenberg_works`;--> statement-breakpoint
ALTER TABLE `gutenberg_works` ADD `subtitle` text;--> statement-breakpoint
ALTER TABLE `gutenberg_works` ADD `search_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `gutenberg_works` ADD `subject_key` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `gutenberg_works` ADD `subjects` text;