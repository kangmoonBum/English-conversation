import type { RecordingRecord } from '../types'

/**
 * 녹음 보관 (IndexedDB).
 *
 * 녹음 blob은 localStorage에 넣기엔 크다. 무한정 쌓이면 브라우저 저장 용량을
 * 잡아먹으므로 두 가지로 제한한다:
 *   - 7일이 지난 녹음은 자동 삭제
 *   - 한 문장당 최신 것 하나만 보관 (같은 key로 덮어쓴다)
 *
 * 녹음은 학습자의 목소리다. 어디에도 전송하지 않고 이 브라우저 안에만 둔다.
 */

const DB_NAME = 'shadowing-trainer'
const DB_VERSION = 1
const STORE = 'recordings'
const TTL_MS = 7 * 24 * 60 * 60 * 1000

let dbPromise: Promise<IDBDatabase> | null = null

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' })
        store.createIndex('createdAt', 'createdAt')
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
  return dbPromise
}

const keyOf = (scenarioId: string, turnId: number) => `${scenarioId}:${turnId}`

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode)
        const request = run(transaction.objectStore(STORE))
        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
      }),
  )
}

export async function saveRecording(
  scenarioId: string,
  turnId: number,
  blob: Blob,
  mimeType: string,
): Promise<void> {
  const record: RecordingRecord = {
    key: keyOf(scenarioId, turnId),
    scenarioId,
    turnId,
    blob,
    mimeType,
    createdAt: Date.now(),
  }
  try {
    await tx('readwrite', (store) => store.put(record))
  } catch {
    // 저장에 실패해도 이번 세션의 비교 재생은 메모리로 계속 가능하다.
  }
}

export async function loadRecording(
  scenarioId: string,
  turnId: number,
): Promise<RecordingRecord | null> {
  try {
    const result = await tx<RecordingRecord | undefined>('readonly', (store) =>
      store.get(keyOf(scenarioId, turnId)),
    )
    if (!result) return null
    if (Date.now() - result.createdAt > TTL_MS) {
      void deleteRecording(scenarioId, turnId)
      return null
    }
    return result
  } catch {
    return null
  }
}

export async function deleteRecording(scenarioId: string, turnId: number): Promise<void> {
  try {
    await tx('readwrite', (store) => store.delete(keyOf(scenarioId, turnId)))
  } catch {
    // 무시
  }
}

/** 앱 시작 시 한 번 호출해 오래된 녹음을 정리한다. */
export async function purgeExpired(): Promise<number> {
  try {
    const db = await openDb()
    return await new Promise<number>((resolve) => {
      const transaction = db.transaction(STORE, 'readwrite')
      const index = transaction.objectStore(STORE).index('createdAt')
      const range = IDBKeyRange.upperBound(Date.now() - TTL_MS)
      let removed = 0

      index.openCursor(range).onsuccess = (event) => {
        const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result
        if (cursor) {
          cursor.delete()
          removed++
          cursor.continue()
        } else {
          resolve(removed)
        }
      }
      transaction.onerror = () => resolve(removed)
    })
  } catch {
    return 0
  }
}
