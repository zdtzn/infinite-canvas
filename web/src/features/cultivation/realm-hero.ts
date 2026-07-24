type RealmHeroTheme = {
    imageSrc: string;
    description: string;
    progressMessage: string;
    completedProgressMessage?: string;
    imagePosition?: string;
};

const realmAsset = (fileName: string) => `/cultivation-realms/${fileName}`;

const fallbackRealmHero: RealmHeroTheme = {
    imageSrc: realmAsset("realm-dou-qi.webp"),
    description: "每一次创作，都会为下一段成长沉淀力量。",
    progressMessage: "斗气初醒，先让每一次创作沉淀为继续前行的力量。",
    imagePosition: "center",
};

const realmHeroThemes: Record<string, RealmHeroTheme> = {
    "realm-dou-qi": {
        imageSrc: realmAsset("realm-dou-qi.webp"),
        description: "灵气初现，先让每一次创作沉静下来。",
        progressMessage: "斗气初醒，先让每一次创作沉淀为继续前行的力量。",
        imagePosition: "center",
    },
    "realm-dou-zhe": {
        imageSrc: realmAsset("realm-dou-zhe.webp"),
        description: "气息开始汇聚，创作的方向逐渐清晰。",
        progressMessage: "初窥修炼之门，继续积累斗气，前路才刚刚开始。",
        imagePosition: "center",
    },
    "realm-dou-shi": {
        imageSrc: realmAsset("realm-dou-shi.webp"),
        description: "能量凝成稳定的秩序，想法开始落地成形。",
        progressMessage: "根基渐稳，修炼切勿急躁，每一次创作都在沉淀实力。",
        imagePosition: "center",
    },
    "realm-da-dou-shi": {
        imageSrc: realmAsset("realm-da-dou-shi.webp"),
        description: "积累不再只是数量，新的结构正在显现。",
        progressMessage: "实力初成，但真正的强者仍在前方，坚持修炼，终有突破。",
        imagePosition: "center",
    },
    "realm-dou-ling": {
        imageSrc: realmAsset("realm-dou-ling.webp"),
        description: "灵性在画面之间流动，创作拥有自己的节奏。",
        progressMessage: "斗气凝形，万物有灵，距离真正的强者只差一步。",
        imagePosition: "center",
    },
    "realm-dou-wang": {
        imageSrc: realmAsset("realm-dou-wang.webp"),
        description: "云海之上，视野与掌控力一同展开。",
        progressMessage: "化翼腾空，方可俯瞰天地，继续创作，迎接第一次蜕变。",
        imagePosition: "center",
    },
    "realm-dou-huang": {
        imageSrc: realmAsset("realm-dou-huang.webp"),
        description: "天地能量翻涌，创作开始拥有更大的尺度。",
        progressMessage: "王者已成，皇者未至，真正的考验才刚刚开始。",
        imagePosition: "center",
    },
    "realm-dou-zong": {
        imageSrc: realmAsset("realm-dou-zong.webp"),
        description: "空间被重新打开，灵感可以自由延展。",
        progressMessage: "天地辽阔，唯有不断精进，方能触及空间之力。",
        imagePosition: "center",
    },
    "realm-dou-zun": {
        imageSrc: realmAsset("realm-dou-zun.webp"),
        description: "视野越过边界，每一个选择都更从容。",
        progressMessage: "距离掌控空间仅一步之遥，每一次创作都在积蓄力量。",
        imagePosition: "center",
    },
    "realm-dou-zun-peak": {
        imageSrc: realmAsset("realm-dou-zun-peak.webp"),
        description: "万象归一，下一次突破正在积蓄。",
        progressMessage: "十转圆满在即，守住节奏，让积累在最后一程化作突破。",
        imagePosition: "center",
    },
    "realm-half-saint": {
        imageSrc: realmAsset("realm-half-saint.webp"),
        description: "遗迹苏醒，长期积累开始显出回响。",
        progressMessage: "圣境大门近在眼前，沉住心神，突破就在下一次顿悟。",
        imagePosition: "center",
    },
    "realm-dou-saint": {
        imageSrc: realmAsset("realm-dou-saint.webp"),
        description: "天地之间的秩序，正在回应你的创作。",
        progressMessage: "举手可撼天地，但修炼永无止境，继续迈向巅峰。",
        imagePosition: "center",
    },
    "realm-dou-emperor": {
        imageSrc: realmAsset("realm-dou-emperor.webp"),
        description: "星河之下，创作已成为一种稳定的掌控。",
        progressMessage: "诸天尽头就在眼前，坚持创作，终将问鼎斗帝之境。",
        completedProgressMessage: "万法归一，诸天俯首。手握日月摘星辰 世间无我这般人！",
        imagePosition: "center",
    },
};

export function cultivationRealmHero(realmId: string): RealmHeroTheme {
    return realmHeroThemes[realmId] || fallbackRealmHero;
}
