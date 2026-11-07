CREATE TABLE `photo_captions` (
	`id` text PRIMARY KEY NOT NULL,
	`photo_id` text NOT NULL,
	`text` text NOT NULL,
	`created_at` integer NOT NULL,
	`user_id` text NOT NULL,
	`author_slot` integer NOT NULL,
	FOREIGN KEY (`photo_id`) REFERENCES `photos`(`id`) ON UPDATE no action ON DELETE cascade,
	CHECK (`author_slot` IN (1, 2)),
	CHECK (length(`text`) BETWEEN 1 AND 500)
);
--> statement-breakpoint
CREATE INDEX `photo_captions_photo_created_idx` ON `photo_captions` (`photo_id`,`created_at`);
