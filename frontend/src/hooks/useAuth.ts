import { useContext } from "react";
import AuthContext, { type AuthContextValue } from "../contexts/AuthContextBase";

export default function useAuth(): AuthContextValue {
  // AuthProvider 在应用根部常驻,组件树内取到 null 即为接线错误
  return useContext(AuthContext) as AuthContextValue;
}
