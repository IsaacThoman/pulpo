import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { cacheNamespace, getValue, setValue } from '../../../data/database';
import { useSessionStore } from '../../../store/session';
import type { FolderSort } from './folderSort';

export function useFolderSort() {
  const instanceUrl = useSessionStore((state) => state.instanceUrl);
  const userId = useSessionStore((state) => state.user?.id);
  const namespace = cacheNamespace(instanceUrl, userId ?? '');
  const [stored, setStored] = useState<{ namespace: string; sort: FolderSort } | null>(null);
  const revision = useRef(0);
  useEffect(() => {
    let active = true;
    const currentRevision = revision.current;
    void getValue<FolderSort>(namespace, 'folderSort').then((value) => {
      if (active && currentRevision === revision.current) setStored({ namespace, sort: value === 'ascending' || value === 'descending' ? value : 'default' });
    }).catch(() => undefined);
    return () => { active = false; };
  }, [namespace]);
  const setSort = useCallback((sort: FolderSort) => {
    revision.current += 1;
    setStored({ namespace, sort });
    void setValue(namespace, 'folderSort', sort).catch(() => Alert.alert('Couldn’t save folder order', 'The order will apply until you close the app.'));
  }, [namespace]);
  return [stored?.namespace === namespace ? stored.sort : 'default', setSort] as const;
}
