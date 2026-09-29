ALTER TABLE `scans` ADD COLUMN `parent_id` text REFERENCES `scans`(`id`);
--> statement-breakpoint
ALTER TABLE `scans` ADD COLUMN `version` integer NOT NULL DEFAULT 1;
--> statement-breakpoint
ALTER TABLE `scans` ADD COLUMN `prompt` text;
