CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_kind` text NOT NULL,
	`source_ref` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `scans` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`stage` text,
	`started_at` text,
	`finished_at` text,
	`models_used` text,
	`error` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `findings` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`detector` text NOT NULL,
	`severity` text NOT NULL,
	`confidence` real NOT NULL,
	`exploitability` real DEFAULT 0 NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`location_path` text NOT NULL,
	`location_line_start` integer NOT NULL,
	`location_line_end` integer,
	`location_commit` text,
	`data_flow` text,
	`evidence_history` text,
	`patch_diff` text,
	`patch_explanation` text,
	`validation_model` text,
	`validation_passes` integer,
	`validation_rationale` text,
	`fp_filtered` integer DEFAULT false NOT NULL,
	`tags` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `findings_scan_severity_idx` ON `findings` (`scan_id`,`severity`);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `findings_scan_fp_idx` ON `findings` (`scan_id`,`fp_filtered`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `commits` (
	`sha` text NOT NULL,
	`scan_id` text NOT NULL,
	`author_email` text,
	`author_name` text,
	`authored_at` text,
	`message` text,
	`files_changed` integer,
	`insertions` integer,
	`deletions` integer,
	`risk_score` real,
	PRIMARY KEY(`sha`, `scan_id`),
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `commits_scan_authored_idx` ON `commits` (`scan_id`,`authored_at`);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `authors` (
	`scan_id` text NOT NULL,
	`email` text NOT NULL,
	`name` text,
	`commit_count` integer DEFAULT 0 NOT NULL,
	`first_seen` text,
	`last_seen` text,
	`anomaly_flags` text,
	PRIMARY KEY(`scan_id`, `email`),
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`scan_id` text NOT NULL,
	`format` text NOT NULL,
	`path` text NOT NULL,
	`generated_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `config` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
