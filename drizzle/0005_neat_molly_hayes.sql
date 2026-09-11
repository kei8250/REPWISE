CREATE TABLE `accepted_next_target` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'default' NOT NULL,
	`mutation_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`source_workout_id` text NOT NULL,
	`source_workout_version` integer NOT NULL,
	`target_load_grams` integer NOT NULL,
	`target_rep_min` integer NOT NULL,
	`target_rep_max` integer NOT NULL,
	`target_working_sets` integer NOT NULL,
	`status` text DEFAULT 'accepted' NOT NULL,
	`applied_workout_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_master`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`source_workout_id`) REFERENCES `workout`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`applied_workout_id`) REFERENCES `workout`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accepted_next_target_mutation` ON `accepted_next_target` (`mutation_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_accepted_next_target_current` ON `accepted_next_target` (`owner_id`,`exercise_id`) WHERE "accepted_next_target"."status" = 'accepted';--> statement-breakpoint
CREATE INDEX `idx_accepted_next_target_source` ON `accepted_next_target` (`owner_id`,`source_workout_id`);--> statement-breakpoint
CREATE INDEX `idx_accepted_next_target_applied` ON `accepted_next_target` (`applied_workout_id`);