import { createClient } from "@supabase/supabase-js";

const supabaseUrl = "https://ousjrslgstusqkexchyp.supabase.co";
const supabaseKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im91c2pyc2xnc3R1c3FrZXhjaHlwIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNzU1MjksImV4cCI6MjA5MTk1MTUyOX0.EZXLb3Zo50asM_a7p4Y6JrPMKAcqtqVIuweGOCnQjm4";

export const supabase = createClient(supabaseUrl, supabaseKey);