import { createContext, useContext, ReactNode } from "react";
import { wardahUITheme } from "@/lib/wardah-ui-theme";

// Define the theme context type
interface WardahThemeContextType {
  theme: typeof wardahUITheme;
}

// Create the context with default values
const WardahThemeContext = createContext<WardahThemeContextType>({
  theme: wardahUITheme,
});

// Props for the theme provider
interface WardahThemeProviderProps {
  children: ReactNode;
}

// Theme provider component
export function WardahThemeProvider({ children }: WardahThemeProviderProps) {
  return (
    <WardahThemeContext.Provider value={{ theme: wardahUITheme }}>
      {children}
    </WardahThemeContext.Provider>
  );
}

// Hook to use the theme context
export const useWardahTheme = () => {
  const context = useContext(WardahThemeContext);
  if (!context) {
    throw new Error("useWardahTheme must be used within a WardahThemeProvider");
  }
  return context;
}

// Re-export the theme for direct import
export { wardahUITheme };
export type { WardahThemeContextType };