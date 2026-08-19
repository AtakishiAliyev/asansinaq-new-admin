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
    PostgrestVersion: "14.15"
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
      answer_keys: {
        Row: {
          answer: string
          book_id: number
          created_at: string
          created_by: string | null
          q_no: number
          source_page: number | null
          test_no: number
        }
        Insert: {
          answer: string
          book_id: number
          created_at?: string
          created_by?: string | null
          q_no: number
          source_page?: number | null
          test_no?: number
        }
        Update: {
          answer?: string
          book_id?: number
          created_at?: string
          created_by?: string | null
          q_no?: number
          source_page?: number | null
          test_no?: number
        }
        Relationships: [
          {
            foreignKeyName: "answer_keys_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_keys_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          content_hash: string | null
          created_at: string
          created_by: string | null
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
          created_at: string
          created_by: string | null
          est_cost_usd: number
          id: number
          model: string
          ms: number | null
          op: string
          output_tokens: number | null
          prompt_tokens: number | null
        }
        Insert: {
          cached?: boolean
          created_at?: string
          created_by?: string | null
          est_cost_usd?: number
          id?: never
          model: string
          ms?: number | null
          op: string
          output_tokens?: number | null
          prompt_tokens?: number | null
        }
        Update: {
          cached?: boolean
          created_at?: string
          created_by?: string | null
          est_cost_usd?: number
          id?: never
          model?: string
          ms?: number | null
          op?: string
          output_tokens?: number | null
          prompt_tokens?: number | null
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
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name?: string
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
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
          book_id: number
          category_id: number | null
          claimed_at: string | null
          claimed_by: string | null
          col: number
          created_at: string
          created_by: string | null
          crop_mime: string
          crop_path: string
          empirical_difficulty: number | null
          extraction_error: string | null
          figure_kind: string
          figures: Json | null
          flags: Json
          id: number
          is_scan: boolean
          model: string | null
          needs_attention: boolean | null
          options: Json | null
          page_number: number
          prompt_version: number | null
          q_no: number
          queued_at: string | null
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
          book_id: number
          category_id?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          col: number
          created_at?: string
          created_by?: string | null
          crop_mime: string
          crop_path: string
          empirical_difficulty?: number | null
          extraction_error?: string | null
          figure_kind: string
          figures?: Json | null
          flags?: Json
          id?: never
          is_scan?: boolean
          model?: string | null
          needs_attention?: boolean | null
          options?: Json | null
          page_number: number
          prompt_version?: number | null
          q_no: number
          queued_at?: string | null
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
          book_id?: number
          category_id?: number | null
          claimed_at?: string | null
          claimed_by?: string | null
          col?: number
          created_at?: string
          created_by?: string | null
          crop_mime?: string
          crop_path?: string
          empirical_difficulty?: number | null
          extraction_error?: string | null
          figure_kind?: string
          figures?: Json | null
          flags?: Json
          id?: never
          is_scan?: boolean
          model?: string | null
          needs_attention?: boolean | null
          options?: Json | null
          page_number?: number
          prompt_version?: number | null
          q_no?: number
          queued_at?: string | null
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
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      apply_answer_keys: { Args: { p_pairs: Json }; Returns: number }
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
          book_id: number
          category_id: number | null
          claimed_at: string | null
          claimed_by: string | null
          col: number
          created_at: string
          created_by: string | null
          crop_mime: string
          crop_path: string
          empirical_difficulty: number | null
          extraction_error: string | null
          figure_kind: string
          figures: Json | null
          flags: Json
          id: number
          is_scan: boolean
          model: string | null
          needs_attention: boolean | null
          options: Json | null
          page_number: number
          prompt_version: number | null
          q_no: number
          queued_at: string | null
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
      is_admin: { Args: never; Returns: boolean }
      mark_pages_worked: {
        Args: { p_book_id: number; p_pages: number[] }
        Returns: undefined
      }
      next_queued_book: { Args: never; Returns: number }
      ops_spend_daily: { Args: { p_days?: number }; Returns: Json }
      ops_spend_today: { Args: never; Returns: number }
      ops_summary_today: { Args: never; Returns: Json }
      questions_throughput: { Args: never; Returns: Json }
      queue_lease: { Args: never; Returns: string }
      release_questions: { Args: { p_ids: number[] }; Returns: number }
      renew_claims: { Args: { p_ids: number[] }; Returns: number }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
