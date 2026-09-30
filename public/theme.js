// theme.js — 亮/暗主题引擎（亮色为默认）
// 主题状态由 <html data-theme="light|dark"> 驱动，localStorage 持久化。
// 各页面 <head> 中的内联初始化脚本负责首屏前设定，避免主题闪烁。
(function () {
    const THEME_KEY = 'talk4us_theme';

    function getTheme() {
        const t = localStorage.getItem(THEME_KEY);
        return t === 'dark' ? 'dark' : 'light';
    }

    function tooltipFor(lang, theme) {
        const labels = {
            zh: theme === 'light' ? '切换到暗色主题' : '切换到亮色主题',
            en: theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme',
            jp: theme === 'light' ? 'ダークテーマに切替' : 'ライトテーマに切替'
        };
        return labels[lang] || labels.en;
    }

    function applyTheme(theme, persist) {
        if (theme !== 'dark' && theme !== 'light') theme = 'light';
        document.documentElement.setAttribute('data-theme', theme);
        if (persist) localStorage.setItem(THEME_KEY, theme);

        const lang = localStorage.getItem('talk4us_lang') || 'zh';
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            const tip = tooltipFor(lang, theme);
            btn.title = tip;
            btn.setAttribute('aria-label', tip);
        });
    }

    // 暴露给外部页面按需调用
    window.talk4usTheme = { get: getTheme, apply: applyTheme };

    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(getTheme(), false);
        document.querySelectorAll('.theme-toggle').forEach(btn => {
            btn.addEventListener('click', () => {
                applyTheme(getTheme() === 'light' ? 'dark' : 'light', true);
            });
        });
    });
})();
