type RealmHeroTheme = {
    imageSrc: string;
    description: string;
    imagePosition?: string;
};

const realmAsset = (fileName: string) => `/cultivation-realms/${fileName}`;

const fallbackRealmHero: RealmHeroTheme = {
    imageSrc: realmAsset("realm-dou-qi.webp"),
    description: "每一次创作，都会为下一段成长沉淀力量。",
    imagePosition: "center",
};

const realmHeroThemes: Record<string, RealmHeroTheme> = {
    "realm-dou-qi": {
        imageSrc: realmAsset("realm-dou-qi.webp"),
        description: "灵气初现，先让每一次创作沉静下来。",
        imagePosition: "center",
    },
    "realm-dou-zhe": {
        imageSrc: realmAsset("realm-dou-zhe.webp"),
        description: "气息开始汇聚，创作的方向逐渐清晰。",
        imagePosition: "center",
    },
    "realm-dou-shi": {
        imageSrc: realmAsset("realm-dou-shi.webp"),
        description: "能量凝成稳定的秩序，想法开始落地成形。",
        imagePosition: "center",
    },
    "realm-da-dou-shi": {
        imageSrc: realmAsset("realm-da-dou-shi.webp"),
        description: "积累不再只是数量，新的结构正在显现。",
        imagePosition: "center",
    },
    "realm-dou-ling": {
        imageSrc: realmAsset("realm-dou-ling.webp"),
        description: "灵性在画面之间流动，创作拥有自己的节奏。",
        imagePosition: "center",
    },
    "realm-dou-wang": {
        imageSrc: realmAsset("realm-dou-wang.webp"),
        description: "云海之上，视野与掌控力一同展开。",
        imagePosition: "center",
    },
    "realm-dou-huang": {
        imageSrc: realmAsset("realm-dou-huang.webp"),
        description: "天地能量翻涌，创作开始拥有更大的尺度。",
        imagePosition: "center",
    },
    "realm-dou-zong": {
        imageSrc: realmAsset("realm-dou-zong.webp"),
        description: "空间被重新打开，灵感可以自由延展。",
        imagePosition: "center",
    },
    "realm-dou-zun": {
        imageSrc: realmAsset("realm-dou-zun.webp"),
        description: "视野越过边界，每一个选择都更从容。",
        imagePosition: "center",
    },
    "realm-dou-zun-peak": {
        imageSrc: realmAsset("realm-dou-zun-peak.webp"),
        description: "万象归一，下一次突破正在积蓄。",
        imagePosition: "center",
    },
    "realm-half-saint": {
        imageSrc: realmAsset("realm-half-saint.webp"),
        description: "遗迹苏醒，长期积累开始显出回响。",
        imagePosition: "center",
    },
    "realm-dou-saint": {
        imageSrc: realmAsset("realm-dou-saint.webp"),
        description: "天地之间的秩序，正在回应你的创作。",
        imagePosition: "center",
    },
    "realm-dou-emperor": {
        imageSrc: realmAsset("realm-dou-emperor.webp"),
        description: "星河之下，创作已成为一种稳定的掌控。",
        imagePosition: "center",
    },
};

export function cultivationRealmHero(realmId: string): RealmHeroTheme {
    return realmHeroThemes[realmId] || fallbackRealmHero;
}
