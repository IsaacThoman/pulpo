import { useQuery } from '@tanstack/react-query'
import { fetchRecording, recordingQueryKey } from './api'

const TRANSCRIPT_POLL_MS = 4_000

export function useRecordingQuery(userId: string | undefined, id: string) {
  return useQuery({
    queryKey: recordingQueryKey(userId, id),
    queryFn: () => fetchRecording(id),
    // Transcripts are made in the background; a realtime update usually brings them sooner.
    refetchInterval: (query) => query.state.data?.clips.some((clip) => clip.transcript.status === 'pending') ? TRANSCRIPT_POLL_MS : false,
  })
}
