import "./App.css";
import MainPage from "./components/MainPage";
import { ApiProvider } from "./contexts/ApiContext";
import { ThemeProvider } from "@mui/material/styles";
import theme from "./theme";

function App() {
  return (
    <ThemeProvider theme={theme}>
      <ApiProvider>
        <div className="flex h-screen bg-background text-text_primary">
          <MainPage />
        </div>
      </ApiProvider>
    </ThemeProvider>
  );
}

export default App;
