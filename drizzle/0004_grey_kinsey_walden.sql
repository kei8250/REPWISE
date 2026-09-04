ALTER TABLE `workout` ADD `source_workout_id` text;--> statement-breakpoint
CREATE INDEX `idx_workout_owner_source` ON `workout` (`owner_id`,`source_workout_id`);