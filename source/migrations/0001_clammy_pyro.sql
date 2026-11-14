CREATE TABLE `scan_cache` (
	`key` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`expires` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `scan_cache_expiry` ON `scan_cache` (`expires`);--> statement-breakpoint
ALTER TABLE `jobs` ADD `next_attempt` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `head` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `head_cursor` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `head_offset` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `jobs` ADD `target_head` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `job_due` ON `jobs` (`next_attempt`,`done`,`checked`);--> statement-breakpoint
CREATE INDEX `address_unchecked` ON `addresses` (`checked`,`priority`,`address`);