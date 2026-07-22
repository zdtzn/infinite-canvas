import { Aperture, CircleDot, Crown, Diamond, Gauge, Hexagon, Infinity, Orbit, Shield, Sparkles, Star, Sun, Waves } from "lucide-react";

const icons = { Aperture, CircleDot, Crown, Diamond, Gauge, Hexagon, Infinity, Orbit, Shield, Sparkles, Star, Sun, Waves };

export function RealmIcon({ iconKey, className }: { iconKey: string; className?: string }) {
    const Icon = icons[iconKey as keyof typeof icons] || Sparkles;
    return <Icon className={className} />;
}
