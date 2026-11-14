CREATE TABLE `addresses` (
	`address` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`label` text NOT NULL,
	`category` text NOT NULL,
	`source` text NOT NULL,
	`source_url` text NOT NULL,
	`confidence` text NOT NULL,
	`updated` text NOT NULL,
	`priority` integer DEFAULT 1 NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `address_entity` ON `addresses` (`entity`);--> statement-breakpoint
CREATE INDEX `address_checked` ON `addresses` (`priority`,`checked`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`chain` text NOT NULL,
	`cursor` text DEFAULT '' NOT NULL,
	`offset` integer DEFAULT 0 NOT NULL,
	`done` integer DEFAULT 0 NOT NULL,
	`pages` integer DEFAULT 0 NOT NULL,
	`checked` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
CREATE TABLE `meta` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `observations` (
	`outpoint` text PRIMARY KEY NOT NULL,
	`address` text NOT NULL,
	`entity` text NOT NULL,
	`value` integer NOT NULL,
	`btc_tx` text,
	`xbt_tx` text,
	`status` text NOT NULL,
	`time` integer NOT NULL,
	`btc_time` integer,
	`xbt_time` integer,
	`btc_confs` integer DEFAULT 0 NOT NULL,
	`xbt_confs` integer DEFAULT 0 NOT NULL,
	`inscription` integer DEFAULT 0 NOT NULL,
	`signature_signal` integer DEFAULT 0 NOT NULL,
	`detail` text NOT NULL,
	`checked` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `observation_status_time` ON `observations` (`status`,`time`);