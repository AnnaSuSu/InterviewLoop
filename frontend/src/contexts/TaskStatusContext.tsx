import { useState, useRef, useCallback, type ReactNode } from "react";
import { getTaskStatus } from "../api/interview";
import TaskStatusContext, { type TaskInfo } from "./TaskStatusContextBase";

const POLL_INTERVAL = 3000;

export function TaskStatusProvider({ children }: { children: ReactNode }) {
  const [tasks, setTasks] = useState<TaskInfo[]>([]);
  const timersRef = useRef<Record<string, ReturnType<typeof setInterval>>>({});

  const stopPolling = useCallback((taskId: string) => {
    if (timersRef.current[taskId]) {
      clearInterval(timersRef.current[taskId]);
      delete timersRef.current[taskId];
    }
  }, []);

  const startTask = useCallback(
    (id: string, type: string, label: string) => {
      stopPolling(id);
      setTasks((prev) => {
        const filtered = prev.filter((t) => t.id !== id);
        return [...filtered, { id, type, label, status: "pending" as const }];
      });

      timersRef.current[id] = setInterval(async () => {
        try {
          const data = (await getTaskStatus(id)) as {
            status?: string;
            result?: unknown;
          };
          if (data.status === "done" || data.status === "error") {
            setTasks((prev) =>
              prev.map((t) =>
                t.id === id
                  ? { ...t, status: data.status as TaskInfo["status"], result: data.result }
                  : t
              )
            );
            stopPolling(id);
          }
        } catch {
          // task not ready or network error, keep polling
        }
      }, POLL_INTERVAL);
    },
    [stopPolling]
  );

  const dismissTask = useCallback(
    (id: string) => {
      stopPolling(id);
      setTasks((prev) => prev.filter((t) => t.id !== id));
    },
    [stopPolling]
  );

  // Global state to track interview creation across route navigations
  const [creatingSessionMode, setCreatingSessionMode] = useState<string | null>(
    null
  );

  return (
    <TaskStatusContext.Provider
      value={{
        tasks,
        startTask,
        dismissTask,
        creatingSessionMode,
        setCreatingSessionMode,
      }}
    >
      {children}
    </TaskStatusContext.Provider>
  );
}
