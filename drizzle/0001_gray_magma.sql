CREATE TABLE `exercise_master` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`normalized_name` text NOT NULL,
	`body_part` text NOT NULL,
	`measurement_type` text DEFAULT 'weight_reps' NOT NULL,
	`default_rep_min` integer,
	`default_rep_max` integer,
	`default_working_sets` integer,
	`default_increment_grams` integer,
	`default_rest_seconds` integer,
	`archived_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_exercise_master_owner_body_part` ON `exercise_master` (`owner_id`,`body_part`);--> statement-breakpoint
CREATE UNIQUE INDEX `uq_exercise_master_owner_name` ON `exercise_master` (`owner_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `workout_exercise` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`exercise_name_snapshot` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`started_at` text,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workout`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercise_master`(`id`) ON UPDATE no action ON DELETE restrict
);
--> statement-breakpoint
CREATE INDEX `idx_workout_exercise_workout_position` ON `workout_exercise` (`workout_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_workout_exercise_exercise` ON `workout_exercise` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `workout_set` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`status` text DEFAULT 'planned' NOT NULL,
	`set_type` text DEFAULT 'working' NOT NULL,
	`target_load_grams` integer,
	`target_rep_min` integer,
	`target_rep_max` integer,
	`actual_load_grams` integer,
	`actual_reps` integer,
	`memo` text DEFAULT '' NOT NULL,
	`completed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	FOREIGN KEY (`workout_exercise_id`) REFERENCES `workout_exercise`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_workout_set_exercise_position` ON `workout_set` (`workout_exercise_id`,`position`);--> statement-breakpoint
CREATE TABLE `workout` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text DEFAULT 'default' NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`local_date` text NOT NULL,
	`timezone` text NOT NULL,
	`started_at` text NOT NULL,
	`ended_at` text,
	`overall_note` text DEFAULT '' NOT NULL,
	`rating` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_workout_owner_date` ON `workout` (`owner_id`,`local_date`);--> statement-breakpoint
CREATE INDEX `idx_workout_owner_status` ON `workout` (`owner_id`,`status`);
--> statement-breakpoint
INSERT OR IGNORE INTO `exercise_master`
  (`id`, `owner_id`, `name`, `normalized_name`, `body_part`, `measurement_type`, `default_rep_min`, `default_rep_max`, `default_working_sets`, `default_increment_grams`, `default_rest_seconds`, `created_at`, `updated_at`)
VALUES
  ('ex-bench-press', 'default', 'ベンチプレス', 'ベンチプレス', '胸', 'weight_reps', 8, 10, 3, 2500, 120, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-incline-dumbbell-press', 'default', 'インクラインDBプレス', 'インクラインdbプレス', '胸', 'weight_reps', 8, 12, 3, 2000, 90, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-cable-fly', 'default', 'ケーブルフライ', 'ケーブルフライ', '胸', 'weight_reps', 10, 15, 3, 2500, 75, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-lat-pulldown', 'default', 'ラットプルダウン', 'ラットプルダウン', '背中', 'weight_reps', 8, 12, 3, 2500, 90, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-deadlift', 'default', 'デッドリフト', 'デッドリフト', '背中', 'weight_reps', 5, 8, 3, 5000, 180, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-seated-row', 'default', 'シーテッドロー', 'シーテッドロー', '背中', 'weight_reps', 8, 12, 3, 2500, 90, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-back-squat', 'default', 'バックスクワット', 'バックスクワット', '脚', 'weight_reps', 6, 10, 3, 2500, 150, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-romanian-deadlift', 'default', 'ルーマニアンデッドリフト', 'ルーマニアンデッドリフト', '脚', 'weight_reps', 8, 12, 3, 2500, 120, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-leg-curl', 'default', 'レッグカール', 'レッグカール', '脚', 'weight_reps', 10, 15, 3, 2500, 75, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-shoulder-press', 'default', 'ショルダープレス', 'ショルダープレス', '肩', 'weight_reps', 8, 12, 3, 2500, 90, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-side-raise', 'default', 'サイドレイズ', 'サイドレイズ', '肩', 'weight_reps', 10, 15, 3, 1000, 60, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-barbell-curl', 'default', 'バーベルカール', 'バーベルカール', '腕', 'weight_reps', 8, 12, 3, 2500, 75, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z'),
  ('ex-triceps-extension', 'default', 'ライイングエクステンション', 'ライイングエクステンション', '腕', 'weight_reps', 8, 12, 3, 2500, 75, '2026-09-01T00:00:00.000Z', '2026-09-01T00:00:00.000Z');
--> statement-breakpoint
PRAGMA optimize;
