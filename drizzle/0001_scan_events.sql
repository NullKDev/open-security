CREATE TABLE IF NOT EXISTS `scan_events` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`scan_id` text NOT NULL,
	`type` text NOT NULL,
	`payload` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`scan_id`) REFERENCES `scans`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `scan_events_scan_id_idx` ON `scan_events` (`scan_id`);
