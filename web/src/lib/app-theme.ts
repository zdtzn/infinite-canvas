import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#171717",
        primaryHover: "#000000",
        primaryText: "#ffffff",
        menuBg: "#f5f5f5",
        menuText: "#171717",
        selectActiveBg: "#f5f5f5",
        selectSelectedBg: "#f0f0f0",
        selectText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
    },
    dark: {
        primary: "#d8402a",
        primaryHover: "#ee5038",
        primaryText: "#fff7ee",
        menuBg: "#23232c",
        menuText: "#edede6",
        selectActiveBg: "#23232c",
        selectSelectedBg: "#2c2c36",
        selectText: "#edede6",
        tableSelectedBg: "rgba(237, 237, 230, 0.06)",
        tableSelectedHoverBg: "rgba(237, 237, 230, 0.1)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}

export function getAdminAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? {
        primary: "#d2b578", primaryHover: "#e2c68d", primaryText: "#1c241f",
        text: "#eeeede", secondary: "#b4bdb3", muted: "#a1b0a4",
        background: "#151d1b", surface: "#1e2824", elevated: "#26322d", subtle: "#29362e",
        border: "#71816f", split: "#39463d", selected: "#394132", jade: "#99c2ad", danger: "#ef9c91",
    } : {
        primary: "#80602b", primaryHover: "#674b1f", primaryText: "#fffefa",
        text: "#2c302d", secondary: "#62675f", muted: "#62695f",
        background: "#f5f4ee", surface: "#fffefa", elevated: "#fffefa", subtle: "#eeefe6",
        border: "#8b9582", split: "#dedfd4", selected: "#f1ebdc", jade: "#3b7467", danger: "#b5423a",
    };
    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "cultivation-admin-dark" : "cultivation-admin-light" },
        token: {
            colorPrimary: color.primary,
            colorPrimaryHover: color.primaryHover,
            colorPrimaryActive: color.primaryHover,
            colorPrimaryBg: color.selected,
            colorInfo: color.jade,
            colorSuccess: color.jade,
            colorWarning: color.primary,
            colorError: color.danger,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primaryHover,
            colorText: color.text,
            colorTextHeading: color.text,
            colorTextSecondary: color.secondary,
            colorTextDescription: color.secondary,
            colorTextTertiary: color.muted,
            colorTextQuaternary: color.muted,
            colorTextPlaceholder: color.muted,
            colorTextLightSolid: color.primaryText,
            colorBgLayout: color.background,
            colorBgContainer: color.surface,
            colorBgElevated: color.elevated,
            colorFillTertiary: color.subtle,
            colorBorder: color.border,
            colorBorderSecondary: color.split,
            colorSplit: color.split,
            borderRadius: 8,
            controlHeight: 36,
            fontSize: 14,
            boxShadow: "0 10px 36px rgb(0 0 0 / 12%)",
            boxShadowSecondary: "0 8px 24px rgb(0 0 0 / 10%)",
        },
        components: {
            Button: { primaryShadow: "none", defaultShadow: "none", dangerShadow: "none", defaultBg: color.surface, defaultColor: color.text, defaultBorderColor: color.border, defaultHoverColor: color.primary, defaultHoverBorderColor: color.primary, textHoverBg: color.subtle },
            Table: { colorText: color.text, colorBgContainer: color.surface, headerBg: color.subtle, headerColor: color.secondary, borderColor: color.split, headerSplitColor: "transparent", rowHoverBg: color.subtle, rowSelectedBg: color.selected, rowSelectedHoverBg: color.selected, cellPaddingBlockMD: 12, cellPaddingInlineMD: 14, cellFontSizeMD: 14 },
            Input: { hoverBg: color.surface, activeBg: color.surface, hoverBorderColor: color.primary, activeBorderColor: color.primary, activeShadow: "none" },
            InputNumber: { hoverBg: color.surface, activeBg: color.surface, hoverBorderColor: color.primary, activeBorderColor: color.primary, activeShadow: "none", controlHeightLG: 48, inputFontSizeLG: 20, lineHeightLG: 1.5, paddingBlockLG: 8 },
            Select: { selectorBg: color.surface, optionActiveBg: color.subtle, optionSelectedBg: color.selected, optionSelectedColor: color.text, hoverBorderColor: color.primary, activeBorderColor: color.primary, optionHeight: 36 },
            Segmented: { trackBg: color.subtle, itemColor: color.secondary, itemHoverBg: color.selected, itemHoverColor: color.text, itemSelectedBg: color.surface, itemSelectedColor: color.text },
            Pagination: { itemBg: color.surface, itemActiveBg: color.selected, itemActiveColor: color.primary },
            Drawer: { colorBgElevated: color.surface, footerPaddingBlock: 16, footerPaddingInline: 24 },
            Modal: { headerBg: color.surface, contentBg: color.surface, footerBg: color.surface, titleColor: color.text, titleFontSize: 18 },
            Tag: { defaultBg: color.subtle, defaultColor: color.secondary },
        },
    };
}
