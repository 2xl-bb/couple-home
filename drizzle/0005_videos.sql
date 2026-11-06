CREATE TABLE `videos` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`caption` text NOT NULL,
	`content_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	`user_id` text NOT NULL,
	`owner_slot` integer NOT NULL,
	`status` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `videos_object_key_unique` ON `videos` (`object_key`);
