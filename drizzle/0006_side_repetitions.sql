ALTER TABLE `exercise_master` ADD `rep_mode` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_exercise` ADD `rep_mode` text DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `workout_set` ADD `actual_reps_left` integer;--> statement-breakpoint
ALTER TABLE `workout_set` ADD `actual_reps_right` integer;