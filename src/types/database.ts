export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      admin_emails: {
        Row: {
          created_at: string
          email: string
          note: string | null
        }
        Insert: {
          created_at?: string
          email: string
          note?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          note?: string | null
        }
        Relationships: []
      }
      answer_key_batches: {
        Row: {
          book_id: number
          created_at: string
          created_by: string | null
          id: number
          key_pages: number[]
          label: string | null
          question_pages: number[]
        }
        Insert: {
          book_id: number
          created_at?: string
          created_by?: string | null
          id?: never
          key_pages: number[]
          label?: string | null
          question_pages: number[]
        }
        Update: {
          book_id?: number
          created_at?: string
          created_by?: string | null
          id?: never
          key_pages?: number[]
          label?: string | null
          question_pages?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "answer_key_batches_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_key_batches_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      answer_key_entries: {
        Row: {
          answer: string
          batch_id: number
          q_no: number
          source_page: number | null
        }
        Insert: {
          answer: string
          batch_id: number
          q_no: number
          source_page?: number | null
        }
        Update: {
          answer?: string
          batch_id?: number
          q_no?: number
          source_page?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "answer_key_entries_batch_id_fkey"
            columns: ["batch_id"]
            isOneToOne: false
            referencedRelation: "answer_key_batches"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_events: {
        Row: {
          at: string
          attempt_id: number
          id: number
          kind: string
          payload: Json | null
          seq: number | null
        }
        Insert: {
          at: string
          attempt_id: number
          id?: never
          kind: string
          payload?: Json | null
          seq?: number | null
        }
        Update: {
          at?: string
          attempt_id?: number
          id?: never
          kind?: string
          payload?: Json | null
          seq?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "attempt_events_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_responses: {
        Row: {
          attempt_id: number
          choice: string | null
          flagged: boolean
          seq: number
          updated_at: string
        }
        Insert: {
          attempt_id: number
          choice?: string | null
          flagged?: boolean
          seq: number
          updated_at?: string
        }
        Update: {
          attempt_id?: number
          choice?: string | null
          flagged?: boolean
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_responses_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      attempt_sketches: {
        Row: {
          attempt_id: number
          data: Json
          layer: string
          seq: number
          updated_at: string
        }
        Insert: {
          attempt_id: number
          data: Json
          layer: string
          seq: number
          updated_at?: string
        }
        Update: {
          attempt_id?: number
          data?: Json
          layer?: string
          seq?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attempt_sketches_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          content_hash: string | null
          created_at: string
          created_by: string | null
          figure_render: string
          file_size: number
          id: number
          note: string | null
          original_name: string
          page_count: number | null
          program_id: number
          storage_path: string | null
          subject_id: number | null
          tags: string[]
          title: string
          updated_at: string
          worked_pages: number[]
        }
        Insert: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          figure_render?: string
          file_size: number
          id?: never
          note?: string | null
          original_name: string
          page_count?: number | null
          program_id: number
          storage_path?: string | null
          subject_id?: number | null
          tags?: string[]
          title: string
          updated_at?: string
          worked_pages?: number[]
        }
        Update: {
          content_hash?: string | null
          created_at?: string
          created_by?: string | null
          figure_render?: string
          file_size?: number
          id?: never
          note?: string | null
          original_name?: string
          page_count?: number | null
          program_id?: number
          storage_path?: string | null
          subject_id?: number | null
          tags?: string[]
          title?: string
          updated_at?: string
          worked_pages?: number[]
        }
        Relationships: [
          {
            foreignKeyName: "books_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "books_subject_same_program"
            columns: ["subject_id", "program_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "program_id"]
          },
        ]
      }
      categories: {
        Row: {
          created_at: string
          id: number
          name: string
          parent_id: number | null
          sort_order: number
          subject_id: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          parent_id?: number | null
          sort_order?: number
          subject_id: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          parent_id?: number | null
          sort_order?: number
          subject_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categories_parent_same_subject"
            columns: ["parent_id", "subject_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id", "subject_id"]
          },
          {
            foreignKeyName: "categories_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_attempts: {
        Row: {
          answers_revealed_at: string | null
          attempt_no: number
          blank_count: number | null
          correct_count: number | null
          current_seq: number
          exam_id: number
          id: number
          kind: string
          last_seen_at: string
          max_score: number | null
          roadmap_node_id: number | null
          score: number | null
          section_scores: Json | null
          started_at: string
          status: string
          submitted_at: string | null
          submitted_by: string | null
          time_used_seconds: number
          updated_at: string
          user_id: string
          version_id: number
          wrong_count: number | null
        }
        Insert: {
          answers_revealed_at?: string | null
          attempt_no: number
          blank_count?: number | null
          correct_count?: number | null
          current_seq?: number
          exam_id: number
          id?: never
          kind?: string
          last_seen_at?: string
          max_score?: number | null
          roadmap_node_id?: number | null
          score?: number | null
          section_scores?: Json | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          time_used_seconds?: number
          updated_at?: string
          user_id: string
          version_id: number
          wrong_count?: number | null
        }
        Update: {
          answers_revealed_at?: string | null
          attempt_no?: number
          blank_count?: number | null
          correct_count?: number | null
          current_seq?: number
          exam_id?: number
          id?: never
          kind?: string
          last_seen_at?: string
          max_score?: number | null
          roadmap_node_id?: number | null
          score?: number | null
          section_scores?: Json | null
          started_at?: string
          status?: string
          submitted_at?: string | null
          submitted_by?: string | null
          time_used_seconds?: number
          updated_at?: string
          user_id?: string
          version_id?: number
          wrong_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exam_attempts_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_roadmap_node_id_fkey"
            columns: ["roadmap_node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_version_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_attempts_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "exam_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_items: {
        Row: {
          exam_id: number
          position: number
          question_id: number
          section_position: number
        }
        Insert: {
          exam_id: number
          position: number
          question_id: number
          section_position: number
        }
        Update: {
          exam_id?: number
          position?: number
          question_id?: number
          section_position?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_items_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_template_sections: {
        Row: {
          duration_seconds: number | null
          penalty_ratio: number
          points_correct: number
          position: number
          program_id: number
          question_count: number
          subject_id: number
          template_id: number
        }
        Insert: {
          duration_seconds?: number | null
          penalty_ratio?: number
          points_correct: number
          position: number
          program_id: number
          question_count: number
          subject_id: number
          template_id: number
        }
        Update: {
          duration_seconds?: number | null
          penalty_ratio?: number
          points_correct?: number
          position?: number
          program_id?: number
          question_count?: number
          subject_id?: number
          template_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_template_sections_subject_id_program_id_fkey"
            columns: ["subject_id", "program_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id", "program_id"]
          },
          {
            foreignKeyName: "exam_template_sections_template_id_program_id_fkey"
            columns: ["template_id", "program_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id", "program_id"]
          },
        ]
      }
      exam_templates: {
        Row: {
          allow_retake: boolean
          archived_at: string | null
          base_score: number
          created_at: string
          duration_seconds: number
          id: number
          min_score: number
          name: string
          name_pattern: string
          navigation: string
          pause_on_exit: boolean
          program_id: number
          reveal_answers: string
          scoring_method: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          allow_retake?: boolean
          archived_at?: string | null
          base_score?: number
          created_at?: string
          duration_seconds: number
          id?: never
          min_score?: number
          name: string
          name_pattern: string
          navigation?: string
          pause_on_exit?: boolean
          program_id: number
          reveal_answers?: string
          scoring_method?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          allow_retake?: boolean
          archived_at?: string | null
          base_score?: number
          created_at?: string
          duration_seconds?: number
          id?: never
          min_score?: number
          name?: string
          name_pattern?: string
          navigation?: string
          pause_on_exit?: boolean
          program_id?: number
          reveal_answers?: string
          scoring_method?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exam_templates_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_version_items: {
        Row: {
          answer: string
          category_id: number | null
          difficulty: number | null
          figures: Json | null
          options: Json
          position: number
          question_id: number | null
          question_updated_at: string | null
          section_position: number
          seq: number
          stem: string
          subject_id: number
          version_id: number
        }
        Insert: {
          answer: string
          category_id?: number | null
          difficulty?: number | null
          figures?: Json | null
          options: Json
          position: number
          question_id?: number | null
          question_updated_at?: string | null
          section_position: number
          seq: number
          stem: string
          subject_id: number
          version_id: number
        }
        Update: {
          answer?: string
          category_id?: number | null
          difficulty?: number | null
          figures?: Json | null
          options?: Json
          position?: number
          question_id?: number | null
          question_updated_at?: string | null
          section_position?: number
          seq?: number
          stem?: string
          subject_id?: number
          version_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_version_items_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_version_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_version_items_subject_id_fkey"
            columns: ["subject_id"]
            isOneToOne: false
            referencedRelation: "subjects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_version_items_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "exam_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      exam_versions: {
        Row: {
          duration_seconds: number | null
          exam_id: number
          id: number
          max_score: number
          published_at: string
          published_by: string | null
          question_count: number
          rules: Json
          version_no: number
        }
        Insert: {
          duration_seconds?: number | null
          exam_id: number
          id?: never
          max_score: number
          published_at?: string
          published_by?: string | null
          question_count: number
          rules: Json
          version_no: number
        }
        Update: {
          duration_seconds?: number | null
          exam_id?: number
          id?: never
          max_score?: number
          published_at?: string
          published_by?: string | null
          question_count?: number
          rules?: Json
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "exam_versions_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exam_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      exams: {
        Row: {
          access_rule: string | null
          created_at: string
          created_by: string | null
          current_version_id: number | null
          draft_updated_at: string
          id: number
          is_visible: boolean
          kind: string
          program_id: number
          seq: number | null
          template_id: number | null
          title: string
          updated_at: string
        }
        Insert: {
          access_rule?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: number | null
          draft_updated_at?: string
          id?: never
          is_visible?: boolean
          kind?: string
          program_id: number
          seq?: number | null
          template_id?: number | null
          title: string
          updated_at?: string
        }
        Update: {
          access_rule?: string | null
          created_at?: string
          created_by?: string | null
          current_version_id?: number | null
          draft_updated_at?: string
          id?: never
          is_visible?: boolean
          kind?: string
          program_id?: number
          seq?: number | null
          template_id?: number | null
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exams_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "exam_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exams_template_id_program_id_fkey"
            columns: ["template_id", "program_id"]
            isOneToOne: false
            referencedRelation: "exam_templates"
            referencedColumns: ["id", "program_id"]
          },
        ]
      }
      ops_cache: {
        Row: {
          created_at: string
          image_path: string | null
          key: string
          model: string | null
          op: string
          prompt_version: number | null
          response: Json | null
        }
        Insert: {
          created_at?: string
          image_path?: string | null
          key: string
          model?: string | null
          op: string
          prompt_version?: number | null
          response?: Json | null
        }
        Update: {
          created_at?: string
          image_path?: string | null
          key?: string
          model?: string | null
          op?: string
          prompt_version?: number | null
          response?: Json | null
        }
        Relationships: []
      }
      ops_log: {
        Row: {
          cached: boolean
          cached_tokens: number | null
          created_at: string
          created_by: string | null
          est_cost_usd: number
          id: number
          model: string
          ms: number | null
          op: string
          output_tokens: number | null
          prompt_tokens: number | null
          via_batch: boolean | null
        }
        Insert: {
          cached?: boolean
          cached_tokens?: number | null
          created_at?: string
          created_by?: string | null
          est_cost_usd?: number
          id?: never
          model: string
          ms?: number | null
          op: string
          output_tokens?: number | null
          prompt_tokens?: number | null
          via_batch?: boolean | null
        }
        Update: {
          cached?: boolean
          cached_tokens?: number | null
          created_at?: string
          created_by?: string | null
          est_cost_usd?: number
          id?: never
          model?: string
          ms?: number | null
          op?: string
          output_tokens?: number | null
          prompt_tokens?: number | null
          via_batch?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "ops_log_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      placement_attempts: {
        Row: {
          answers: Json
          expires_at: string
          question_ids: number[]
          started_at: string
          updated_at: string
          user_id: string
        }
        Insert: {
          answers?: Json
          expires_at: string
          question_ids: number[]
          started_at?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          answers?: Json
          expires_at?: string
          question_ids?: number[]
          started_at?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      placement_blueprint: {
        Row: {
          band: string
          category_id: number
          ord: number
        }
        Insert: {
          band: string
          category_id: number
          ord: number
        }
        Update: {
          band?: string
          category_id?: number
          ord?: number
        }
        Relationships: [
          {
            foreignKeyName: "placement_blueprint_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          goal_score: number | null
          grade: string | null
          id: string
          level: string | null
          onboarded_at: string | null
          placement_at: string | null
          placement_score: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          goal_score?: number | null
          grade?: string | null
          id: string
          level?: string | null
          onboarded_at?: string | null
          placement_at?: string | null
          placement_score?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          goal_score?: number | null
          grade?: string | null
          id?: string
          level?: string | null
          onboarded_at?: string | null
          placement_at?: string | null
          placement_score?: number | null
          updated_at?: string
        }
        Relationships: []
      }
      programs: {
        Row: {
          created_at: string
          id: number
          name: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: []
      }
      question_reports: {
        Row: {
          attempt_id: number | null
          created_at: string
          id: number
          note: string
          question_id: number | null
          resolved_at: string | null
          resolved_by: string | null
          seq: number | null
          status: string
          user_id: string
        }
        Insert: {
          attempt_id?: number | null
          created_at?: string
          id?: never
          note: string
          question_id?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          seq?: number | null
          status?: string
          user_id: string
        }
        Update: {
          attempt_id?: number | null
          created_at?: string
          id?: never
          note?: string
          question_id?: number | null
          resolved_at?: string | null
          resolved_by?: string | null
          seq?: number | null
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_reports_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "question_reports_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      question_responses: {
        Row: {
          answer: string
          answered_at: string | null
          answers_seen_before: boolean
          attempt_no: number
          board_used: boolean
          category_id: number | null
          change_count: number
          choice: string | null
          context_attempt_id: number | null
          context_id: number
          context_kind: string
          context_node_id: number | null
          context_seq: number
          context_version_id: number | null
          difficulty: number | null
          id: number
          is_blank: boolean
          is_correct: boolean
          question_id: number | null
          recorded_at: string
          subject_id: number | null
          time_seconds: number | null
          user_id: string
        }
        Insert: {
          answer: string
          answered_at?: string | null
          answers_seen_before?: boolean
          attempt_no?: number
          board_used?: boolean
          category_id?: number | null
          change_count?: number
          choice?: string | null
          context_attempt_id?: number | null
          context_id: number
          context_kind: string
          context_node_id?: number | null
          context_seq: number
          context_version_id?: number | null
          difficulty?: number | null
          id?: never
          is_blank: boolean
          is_correct: boolean
          question_id?: number | null
          recorded_at?: string
          subject_id?: number | null
          time_seconds?: number | null
          user_id: string
        }
        Update: {
          answer?: string
          answered_at?: string | null
          answers_seen_before?: boolean
          attempt_no?: number
          board_used?: boolean
          category_id?: number | null
          change_count?: number
          choice?: string | null
          context_attempt_id?: number | null
          context_id?: number
          context_kind?: string
          context_node_id?: number | null
          context_seq?: number
          context_version_id?: number | null
          difficulty?: number | null
          id?: never
          is_blank?: boolean
          is_correct?: boolean
          question_id?: number | null
          recorded_at?: string
          subject_id?: number | null
          time_seconds?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "question_responses_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      questions: {
        Row: {
          ai_category_confidence: number | null
          ai_category_id: number | null
          ai_difficulty: number | null
          answer: string | null
          answer_confidence: number | null
          answer_source: string | null
          attempts: number
          auto_approved: boolean
          batch_custom_id: string | null
          batch_id: string | null
          batch_stage: string | null
          book_id: number
          category_id: number | null
          claimed_at: string | null
          claimed_by: string | null
          claimed_by_worker: string | null
          col: number
          created_at: string
          created_by: string | null
          crop_box: Json | null
          crop_mime: string
          crop_path: string
          difficulty: number | null
          empirical_difficulty: number | null
          extraction_error: string | null
          figure_kind: string
          figures: Json | null
          flags: Json
          id: number
          is_scan: boolean
          lease_until: string | null
          model: string | null
          needs_attention: boolean | null
          options: Json | null
          page_number: number
          prev_version: Json | null
          prompt_version: number | null
          q_no: number
          queued_at: string | null
          repair_round: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_difficulty: number | null
          status: string
          stem: string | null
          structured_at: string | null
          test_no: number | null
          text_layer: string | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verify_confidence: number | null
          verify_diff: Json | null
        }
        Insert: {
          ai_category_confidence?: number | null
          ai_category_id?: number | null
          ai_difficulty?: number | null
          answer?: string | null
          answer_confidence?: number | null
          answer_source?: string | null
          attempts?: number
          auto_approved?: boolean
          batch_custom_id?: string | null
          batch_id?: string | null
          batch_stage?: string | null
          book_id: number
          category_id?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_by_worker?: string | null
          col: number
          created_at?: string
          created_by?: string | null
          crop_box?: Json | null
          crop_mime: string
          crop_path: string
          difficulty?: number | null
          empirical_difficulty?: number | null
          extraction_error?: string | null
          figure_kind: string
          figures?: Json | null
          flags?: Json
          id?: never
          is_scan?: boolean
          lease_until?: string | null
          model?: string | null
          needs_attention?: boolean | null
          options?: Json | null
          page_number: number
          prev_version?: Json | null
          prompt_version?: number | null
          q_no: number
          queued_at?: string | null
          repair_round?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_difficulty?: number | null
          status?: string
          stem?: string | null
          structured_at?: string | null
          test_no?: number | null
          text_layer?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verify_confidence?: number | null
          verify_diff?: Json | null
        }
        Update: {
          ai_category_confidence?: number | null
          ai_category_id?: number | null
          ai_difficulty?: number | null
          answer?: string | null
          answer_confidence?: number | null
          answer_source?: string | null
          attempts?: number
          auto_approved?: boolean
          batch_custom_id?: string | null
          batch_id?: string | null
          batch_stage?: string | null
          book_id?: number
          category_id?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          claimed_by_worker?: string | null
          col?: number
          created_at?: string
          created_by?: string | null
          crop_box?: Json | null
          crop_mime?: string
          crop_path?: string
          difficulty?: number | null
          empirical_difficulty?: number | null
          extraction_error?: string | null
          figure_kind?: string
          figures?: Json | null
          flags?: Json
          id?: never
          is_scan?: boolean
          lease_until?: string | null
          model?: string | null
          needs_attention?: boolean | null
          options?: Json | null
          page_number?: number
          prev_version?: Json | null
          prompt_version?: number | null
          q_no?: number
          queued_at?: string | null
          repair_round?: number
          reviewed_at?: string | null
          reviewed_by?: string | null
          reviewer_difficulty?: number | null
          status?: string
          stem?: string | null
          structured_at?: string | null
          test_no?: number | null
          text_layer?: string | null
          updated_at?: string
          verified?: boolean
          verified_at?: string | null
          verify_confidence?: number | null
          verify_diff?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "questions_ai_category_id_fkey"
            columns: ["ai_category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_category_id_fkey"
            columns: ["category_id"]
            isOneToOne: false
            referencedRelation: "categories"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_claimed_by_fkey"
            columns: ["claimed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "questions_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_node_items: {
        Row: {
          node_id: number
          position: number
          question_id: number
        }
        Insert: {
          node_id: number
          position: number
          question_id: number
        }
        Update: {
          node_id?: number
          position?: number
          question_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_node_items_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_node_items_question_id_fkey"
            columns: ["question_id"]
            isOneToOne: false
            referencedRelation: "questions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_nodes: {
        Row: {
          exam_id: number | null
          id: number
          kind: string
          position: number
          stage_id: number
          title: string
        }
        Insert: {
          exam_id?: number | null
          id?: never
          kind?: string
          position: number
          stage_id: number
          title: string
        }
        Update: {
          exam_id?: number | null
          id?: never
          kind?: string
          position?: number
          stage_id?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_nodes_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_nodes_stage_id_fkey"
            columns: ["stage_id"]
            isOneToOne: false
            referencedRelation: "roadmap_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_stages: {
        Row: {
          id: number
          position: number
          roadmap_id: number
          title: string
        }
        Insert: {
          id?: never
          position: number
          roadmap_id: number
          title: string
        }
        Update: {
          id?: never
          position?: number
          roadmap_id?: number
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_stages_roadmap_id_fkey"
            columns: ["roadmap_id"]
            isOneToOne: false
            referencedRelation: "roadmaps"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_version_nodes: {
        Row: {
          exam_id: number
          exam_version_id: number
          id: number
          kind: string
          node_id: number | null
          position: number
          question_count: number
          stage_position: number
          stage_title: string
          title: string
          version_id: number
        }
        Insert: {
          exam_id: number
          exam_version_id: number
          id?: never
          kind: string
          node_id?: number | null
          position: number
          question_count: number
          stage_position: number
          stage_title: string
          title: string
          version_id: number
        }
        Update: {
          exam_id?: number
          exam_version_id?: number
          id?: never
          kind?: string
          node_id?: number | null
          position?: number
          question_count?: number
          stage_position?: number
          stage_title?: string
          title?: string
          version_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_version_nodes_exam_id_fkey"
            columns: ["exam_id"]
            isOneToOne: false
            referencedRelation: "exams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_version_nodes_exam_version_id_fkey"
            columns: ["exam_version_id"]
            isOneToOne: false
            referencedRelation: "exam_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_version_nodes_node_id_fkey"
            columns: ["node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_version_nodes_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmap_versions: {
        Row: {
          description: string
          id: number
          node_count: number
          published_at: string
          published_by: string | null
          question_count: number
          roadmap_id: number
          stage_count: number
          title: string
          version_no: number
        }
        Insert: {
          description?: string
          id?: never
          node_count: number
          published_at?: string
          published_by?: string | null
          question_count: number
          roadmap_id: number
          stage_count: number
          title: string
          version_no: number
        }
        Update: {
          description?: string
          id?: never
          node_count?: number
          published_at?: string
          published_by?: string | null
          question_count?: number
          roadmap_id?: number
          stage_count?: number
          title?: string
          version_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "roadmap_versions_published_by_fkey"
            columns: ["published_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmap_versions_roadmap_id_fkey"
            columns: ["roadmap_id"]
            isOneToOne: false
            referencedRelation: "roadmaps"
            referencedColumns: ["id"]
          },
        ]
      }
      roadmaps: {
        Row: {
          created_at: string
          created_by: string | null
          current_version_id: number | null
          description: string
          draft_updated_at: string
          id: number
          program_id: number
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          current_version_id?: number | null
          description?: string
          draft_updated_at?: string
          id?: never
          program_id: number
          sort_order?: number
          status?: string
          title: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          current_version_id?: number | null
          description?: string
          draft_updated_at?: string
          id?: never
          program_id?: number
          sort_order?: number
          status?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "roadmaps_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmaps_current_version_fkey"
            columns: ["current_version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_versions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "roadmaps_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      subjects: {
        Row: {
          created_at: string
          id: number
          name: string
          program_id: number
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: never
          name: string
          program_id: number
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: never
          name?: string
          program_id?: number
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "subjects_program_id_fkey"
            columns: ["program_id"]
            isOneToOne: false
            referencedRelation: "programs"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roadmap_nodes: {
        Row: {
          attempt_id: number | null
          completed_at: string | null
          started_at: string
          user_roadmap_id: number
          version_node_id: number
        }
        Insert: {
          attempt_id?: number | null
          completed_at?: string | null
          started_at?: string
          user_roadmap_id: number
          version_node_id: number
        }
        Update: {
          attempt_id?: number | null
          completed_at?: string | null
          started_at?: string
          user_roadmap_id?: number
          version_node_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_roadmap_nodes_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "exam_attempts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roadmap_nodes_user_roadmap_id_fkey"
            columns: ["user_roadmap_id"]
            isOneToOne: false
            referencedRelation: "user_roadmaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roadmap_nodes_version_node_id_fkey"
            columns: ["version_node_id"]
            isOneToOne: false
            referencedRelation: "roadmap_version_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roadmaps: {
        Row: {
          completed_at: string | null
          id: number
          roadmap_id: number
          started_at: string
          user_id: string
          version_id: number
        }
        Insert: {
          completed_at?: string | null
          id?: never
          roadmap_id: number
          started_at?: string
          user_id: string
          version_id: number
        }
        Update: {
          completed_at?: string | null
          id?: never
          roadmap_id?: number
          started_at?: string
          user_id?: string
          version_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "user_roadmaps_roadmap_id_fkey"
            columns: ["roadmap_id"]
            isOneToOne: false
            referencedRelation: "roadmaps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roadmaps_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "roadmap_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_control: {
        Row: {
          auto_approve: boolean
          auto_approve_needs_answer: boolean
          desired_state: string
          express: boolean
          id: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_approve?: boolean
          auto_approve_needs_answer?: boolean
          desired_state?: string
          express?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_approve?: boolean
          auto_approve_needs_answer?: boolean
          desired_state?: string
          express?: boolean
          id?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      worker_heartbeat: {
        Row: {
          activity: string
          budget_usd: number | null
          last_error: string | null
          last_error_at: string | null
          last_seen: string
          spend_today: number | null
          started_at: string | null
          state: string
          stopped_at: string | null
          worker_id: string
        }
        Insert: {
          activity?: string
          budget_usd?: number | null
          last_error?: string | null
          last_error_at?: string | null
          last_seen?: string
          spend_today?: number | null
          started_at?: string | null
          state?: string
          stopped_at?: string | null
          worker_id: string
        }
        Update: {
          activity?: string
          budget_usd?: number | null
          last_error?: string | null
          last_error_at?: string | null
          last_seen?: string
          spend_today?: number | null
          started_at?: string | null
          state?: string
          stopped_at?: string | null
          worker_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      analytics_attempts: {
        Args: {
          p_exam_id?: number
          p_limit?: number
          p_offset?: number
          p_user_id?: string
        }
        Returns: {
          attempt_id: number
          attempt_no: number
          blank_count: number
          correct_count: number
          exam_id: number
          exam_title: string
          max_score: number
          reviewed: boolean
          score: number
          student_name: string
          submitted_at: string
          submitted_by: string
          time_used_seconds: number
          total: number
          user_id: string
          wrong_count: number
        }[]
      }
      analytics_deneme: { Args: { p_exam_id: number }; Returns: Json }
      analytics_denemeler: {
        Args: never
        Returns: {
          attempts: number
          avg_pct: number
          avg_score: number
          avg_time_seconds: number
          blank_pct: number
          exam_id: number
          kind: string
          last_attempt_at: string
          max_score: number
          median_score: number
          question_count: number
          retake_pct: number
          seq: number
          students: number
          timeout_pct: number
          title: string
        }[]
      }
      analytics_guard: { Args: never; Returns: undefined }
      analytics_overview: { Args: never; Returns: Json }
      analytics_question: { Args: { p_question_id: number }; Returns: Json }
      analytics_question_stats: {
        Args: { p_question_ids: number[] }
        Returns: {
          avg_time: number
          blank_pct: number
          correct_pct: number
          open_reports: number
          question_id: number
          responses: number
          suspicious: boolean
          wrong_pct: number
        }[]
      }
      analytics_roadmap: { Args: { p_roadmap_id: number }; Returns: Json }
      analytics_roadmaps: {
        Args: never
        Returns: {
          active_7d: number
          avg_correct_pct: number
          avg_progress_pct: number
          completed: number
          completion_pct: number
          enrolled: number
          last_activity_at: string
          median_days: number
          node_count: number
          program_name: string
          question_count: number
          roadmap_id: number
          stage_count: number
          status: string
          title: string
          version_no: number
        }[]
      }
      analytics_student: { Args: { p_user_id: string }; Returns: Json }
      analytics_topics: {
        Args: { p_subject_id?: number }
        Returns: {
          avg_difficulty: number
          avg_time: number
          blank_pct: number
          category_id: number
          category_name: string
          correct_pct: number
          questions: number
          responses: number
          subject_id: number
          subject_name: string
          wrong_pct: number
        }[]
      }
      apply_answer_keys: { Args: { p_pairs: Json }; Returns: number }
      attempt_answer: {
        Args: {
          p_attempt_id: number
          p_choice: string
          p_flagged?: boolean
          p_seq: number
        }
        Returns: number
      }
      attempt_answer_check: {
        Args: { p_attempt_id: number; p_choice: string; p_seq: number }
        Returns: Json
      }
      attempt_beat_cap_seconds: { Args: never; Returns: number }
      attempt_current: { Args: never; Returns: Json }
      attempt_events_add: {
        Args: { p_attempt_id: number; p_events: Json }
        Returns: undefined
      }
      attempt_finalize: {
        Args: { p_attempt_id: number; p_by: string }
        Returns: undefined
      }
      attempt_flag: {
        Args: { p_attempt_id: number; p_flagged: boolean; p_seq: number }
        Returns: number
      }
      attempt_heartbeat: {
        Args: { p_attempt_id: number; p_seq?: number }
        Returns: number
      }
      attempt_pause: {
        Args: { p_attempt_id: number; p_seq?: number }
        Returns: undefined
      }
      attempt_payload: { Args: { p_attempt_id: number }; Returns: Json }
      attempt_record_responses: {
        Args: { p_attempt_id: number }
        Returns: number
      }
      attempt_report: {
        Args: { p_attempt_id: number; p_note: string; p_seq: number }
        Returns: undefined
      }
      attempt_result: { Args: { p_attempt_id: number }; Returns: Json }
      attempt_review: { Args: { p_attempt_id: number }; Returns: Json }
      attempt_sketch_save: {
        Args: {
          p_attempt_id: number
          p_data: Json
          p_layer: string
          p_seq: number
        }
        Returns: undefined
      }
      attempt_sketches_load: { Args: { p_attempt_id: number }; Returns: Json }
      attempt_start: { Args: { p_exam_id: number }; Returns: Json }
      attempt_submit: { Args: { p_attempt_id: number }; Returns: Json }
      attempt_touch: { Args: { p_attempt_id: number }; Returns: number }
      bank_by_topic: {
        Args: { p_subject_id?: number }
        Returns: {
          book_id: number
          category_id: number
          n: number
          status: string
          subject_id: number
        }[]
      }
      claim_expired: {
        Args: { p_claimed_at: string; p_lease_until: string }
        Returns: boolean
      }
      claim_questions: {
        Args: { p_book_id?: number; p_limit: number }
        Returns: {
          ai_category_confidence: number | null
          ai_category_id: number | null
          ai_difficulty: number | null
          answer: string | null
          answer_confidence: number | null
          answer_source: string | null
          attempts: number
          auto_approved: boolean
          batch_custom_id: string | null
          batch_id: string | null
          batch_stage: string | null
          book_id: number
          category_id: number | null
          claimed_at: string | null
          claimed_by: string | null
          claimed_by_worker: string | null
          col: number
          created_at: string
          created_by: string | null
          crop_box: Json | null
          crop_mime: string
          crop_path: string
          difficulty: number | null
          empirical_difficulty: number | null
          extraction_error: string | null
          figure_kind: string
          figures: Json | null
          flags: Json
          id: number
          is_scan: boolean
          lease_until: string | null
          model: string | null
          needs_attention: boolean | null
          options: Json | null
          page_number: number
          prev_version: Json | null
          prompt_version: number | null
          q_no: number
          queued_at: string | null
          repair_round: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_difficulty: number | null
          status: string
          stem: string | null
          structured_at: string | null
          test_no: number | null
          text_layer: string | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verify_confidence: number | null
          verify_diff: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_questions_worker: {
        Args: {
          p_book_id?: number
          p_lease: string
          p_limit: number
          p_worker_id: string
        }
        Returns: {
          ai_category_confidence: number | null
          ai_category_id: number | null
          ai_difficulty: number | null
          answer: string | null
          answer_confidence: number | null
          answer_source: string | null
          attempts: number
          auto_approved: boolean
          batch_custom_id: string | null
          batch_id: string | null
          batch_stage: string | null
          book_id: number
          category_id: number | null
          claimed_at: string | null
          claimed_by: string | null
          claimed_by_worker: string | null
          col: number
          created_at: string
          created_by: string | null
          crop_box: Json | null
          crop_mime: string
          crop_path: string
          difficulty: number | null
          empirical_difficulty: number | null
          extraction_error: string | null
          figure_kind: string
          figures: Json | null
          flags: Json
          id: number
          is_scan: boolean
          lease_until: string | null
          model: string | null
          needs_attention: boolean | null
          options: Json | null
          page_number: number
          prev_version: Json | null
          prompt_version: number | null
          q_no: number
          queued_at: string | null
          repair_round: number
          reviewed_at: string | null
          reviewed_by: string | null
          reviewer_difficulty: number | null
          status: string
          stem: string | null
          structured_at: string | null
          test_no: number | null
          text_layer: string | null
          updated_at: string
          verified: boolean
          verified_at: string | null
          verify_confidence: number | null
          verify_diff: Json | null
        }[]
        SetofOptions: {
          from: "*"
          to: "questions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      clear_queue: { Args: never; Returns: Json }
      enqueue_questions: { Args: { p_ids: number[] }; Returns: number }
      exam_autofill_pick: {
        Args: { p_cells: Json; p_exam_id: number; p_unused_only?: boolean }
        Returns: {
          category_id: number
          difficulty: number
          question_id: number
        }[]
      }
      exam_create: {
        Args: { p_template_id: number }
        Returns: {
          access_rule: string | null
          created_at: string
          created_by: string | null
          current_version_id: number | null
          draft_updated_at: string
          id: number
          is_visible: boolean
          kind: string
          program_id: number
          seq: number | null
          template_id: number | null
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "exams"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exam_draft_items: {
        Args: { p_exam_id: number }
        Returns: {
          answer: string
          category_id: number
          changed_since_publish: boolean
          difficulty: number
          figures: Json
          item_position: number
          options: Json
          question_id: number
          section_position: number
          status: string
          stem: string
          usage_count: number
        }[]
      }
      exam_has_figures: { Args: { p_figures: Json }; Returns: boolean }
      exam_like_pattern: { Args: { p_search: string }; Returns: string }
      exam_publish: {
        Args: { p_assets?: Json; p_exam_id: number }
        Returns: {
          duration_seconds: number | null
          exam_id: number
          id: number
          max_score: number
          published_at: string
          published_by: string | null
          question_count: number
          rules: Json
          version_no: number
        }
        SetofOptions: {
          from: "*"
          to: "exam_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exam_question_facets: {
        Args: {
          p_exam_id?: number
          p_figures?: string
          p_search?: string
          p_subject_id: number
          p_unused_only?: boolean
        }
        Returns: {
          category_id: number
          difficulty: number
          n: number
        }[]
      }
      exam_question_search: {
        Args: {
          p_after_id?: number
          p_category_ids?: number[]
          p_difficulties?: number[]
          p_exam_id?: number
          p_figures?: string
          p_limit?: number
          p_search?: string
          p_subject_id: number
          p_unused_only?: boolean
        }
        Returns: {
          answer: string
          book_id: number
          category_id: number
          difficulty: number
          figures: Json
          id: number
          in_exam: boolean
          options: Json
          page_number: number
          q_no: number
          stem: string
          usage_count: number
        }[]
      }
      exam_set_items: {
        Args: {
          p_exam_id: number
          p_question_ids: number[]
          p_section_position: number
        }
        Returns: undefined
      }
      exam_snapshot_options: {
        Args: { p_options: Json; p_urls: Json }
        Returns: Json
      }
      exam_template_save: {
        Args: { p_id: number; p_sections: Json; p_template: Json }
        Returns: {
          allow_retake: boolean
          archived_at: string | null
          base_score: number
          created_at: string
          duration_seconds: number
          id: number
          min_score: number
          name: string
          name_pattern: string
          navigation: string
          pause_on_exit: boolean
          program_id: number
          reveal_answers: string
          scoring_method: string
          sort_order: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "exam_templates"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      finish_questions_worker: {
        Args: { p_ids: number[]; p_worker_id: string }
        Returns: number
      }
      is_admin: { Args: never; Returns: boolean }
      mark_pages_worked: {
        Args: { p_book_id: number; p_pages: number[] }
        Returns: undefined
      }
      next_queued_book: { Args: never; Returns: number }
      ops_spend_daily: { Args: { p_days?: number }; Returns: Json }
      ops_spend_today: { Args: never; Returns: number }
      ops_summary_today: { Args: never; Returns: Json }
      placement_answer: {
        Args: { p_choice: string; p_question_id: number }
        Returns: undefined
      }
      placement_finalize: {
        Args: { p_answers: Json; p_user: string }
        Returns: Json
      }
      placement_skip: { Args: never; Returns: Json }
      placement_start: { Args: never; Returns: Json }
      placement_state: { Args: never; Returns: Json }
      placement_submit: { Args: { p_answers?: Json }; Returns: Json }
      question_flag_counts: {
        Args: { p_book_id?: number; p_status?: string }
        Returns: {
          code: string
          level: string
          n: number
        }[]
      }
      questions_throughput: { Args: never; Returns: Json }
      queue_lease: { Args: never; Returns: string }
      release_questions: { Args: { p_ids: number[] }; Returns: number }
      release_questions_worker: {
        Args: { p_ids: number[]; p_worker_id: string }
        Returns: number
      }
      renew_claims: { Args: { p_ids: number[] }; Returns: number }
      renew_claims_worker: {
        Args: { p_ids: number[]; p_lease: string; p_worker_id: string }
        Returns: number
      }
      roadmap_archive: {
        Args: { p_archived: boolean; p_roadmap_id: number }
        Returns: undefined
      }
      roadmap_create: {
        Args: { p_program_id: number; p_title: string }
        Returns: {
          created_at: string
          created_by: string | null
          current_version_id: number | null
          description: string
          draft_updated_at: string
          id: number
          program_id: number
          sort_order: number
          status: string
          title: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "roadmaps"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      roadmap_detail: { Args: { p_roadmap_id: number }; Returns: Json }
      roadmap_draft_questions: {
        Args: { p_roadmap_id: number }
        Returns: {
          item_position: number
          node_id: number
          question_id: number
        }[]
      }
      roadmap_node_add: {
        Args: { p_kind?: string; p_stage_id: number; p_title: string }
        Returns: {
          exam_id: number | null
          id: number
          kind: string
          position: number
          stage_id: number
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "roadmap_nodes"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      roadmap_node_complete: {
        Args: { p_attempt_id: number }
        Returns: undefined
      }
      roadmap_node_delete: { Args: { p_node_id: number }; Returns: undefined }
      roadmap_node_move: {
        Args: { p_node_id: number; p_position: number; p_stage_id: number }
        Returns: undefined
      }
      roadmap_node_set_items: {
        Args: { p_node_id: number; p_question_ids: number[] }
        Returns: undefined
      }
      roadmap_node_start: { Args: { p_version_node_id: number }; Returns: Json }
      roadmap_publish: {
        Args: { p_assets: Json; p_roadmap_id: number }
        Returns: {
          description: string
          id: number
          node_count: number
          published_at: string
          published_by: string | null
          question_count: number
          roadmap_id: number
          stage_count: number
          title: string
          version_no: number
        }
        SetofOptions: {
          from: "*"
          to: "roadmap_versions"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      roadmap_publish_problems: {
        Args: { p_roadmap_id: number }
        Returns: string[]
      }
      roadmap_stage_add: {
        Args: { p_roadmap_id: number; p_title: string }
        Returns: {
          id: number
          position: number
          roadmap_id: number
          title: string
        }
        SetofOptions: {
          from: "*"
          to: "roadmap_stages"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      roadmap_stage_delete: { Args: { p_stage_id: number }; Returns: undefined }
      roadmap_stage_reorder: {
        Args: { p_roadmap_id: number; p_stage_ids: number[] }
        Returns: undefined
      }
      roadmap_start: { Args: { p_roadmap_id: number }; Returns: Json }
      roadmap_touch: { Args: { p_roadmap_id: number }; Returns: undefined }
      roadmaps_list: { Args: never; Returns: Json }
      student_exams: {
        Args: never
        Returns: {
          answered: number
          attempt_count: number
          attempt_id: number
          best_score: number
          correct: number
          duration_seconds: number
          id: number
          max_score: number
          program_name: string
          published_at: string
          question_count: number
          score: number
          sections: Json
          seq: number
          status: string
          template_name: string
          title: string
          version_no: number
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
