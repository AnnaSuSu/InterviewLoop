import { createContext } from "react";

export interface TaskInfo {
  id: string;
  type: string;
  label: string;
  status: "pending" | "done" | "error";
  result?: unknown;
}

export interface TaskStatusContextValue {
  tasks: TaskInfo[];
  startTask: (id: string, type: string, label: string) => void;
  dismissTask: (id: string) => void;
  creatingSessionMode: string | null;
  setCreatingSessionMode: (mode: string | null) => void;
}

const TaskStatusContext = createContext<TaskStatusContextValue | null>(null);

export default TaskStatusContext;
