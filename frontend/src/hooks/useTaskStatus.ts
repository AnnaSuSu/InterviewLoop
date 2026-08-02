import { useContext } from "react";
import TaskStatusContext, {
  type TaskStatusContextValue,
} from "../contexts/TaskStatusContextBase";

export default function useTaskStatus(): TaskStatusContextValue {
  // TaskStatusProvider 在应用根部常驻,组件树内取到 null 即为接线错误
  return useContext(TaskStatusContext) as TaskStatusContextValue;
}
