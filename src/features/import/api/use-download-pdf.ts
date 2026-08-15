import { useMutation } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// Pulls an archived book back out of the bucket so it can be re-processed
// without hunting for the original file.
export function useDownloadPdf() {
  return useMutation({
    mutationFn: async (path: string): Promise<ArrayBuffer> => {
      const { data, error } = await supabase.storage.from('pdfs').download(path)
      if (error) throw error
      return data.arrayBuffer()
    },
  })
}
