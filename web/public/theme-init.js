try {
    var themeState = JSON.parse(localStorage.getItem("infinite-canvas:theme_store") || "{}");
    var initialTheme = themeState.state && themeState.state.theme === "light" ? "light" : "dark";
    document.documentElement.classList.toggle("dark", initialTheme === "dark");
    document.documentElement.style.colorScheme = initialTheme;
} catch {
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
}
