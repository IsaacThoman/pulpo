import { useEffect, useState } from 'react'
import { apiRequest } from '@/lib/api'

export interface AvailableModel {
  id: string
  name: string
  tags: string[]
}

export function useAvailableModels(): AvailableModel[] {
  const [models, setModels] = useState<AvailableModel[]>([])

  useEffect(() => {
    void apiRequest<{ data: AvailableModel[] }>('/api/models')
      .then((response) => setModels(response.data))
  }, [])

  return models
}

export function modelOptionLabel(model: Pick<AvailableModel, 'id' | 'name'>): string {
  return model.name === model.id ? model.name : `${model.name} (${model.id})`
}
