import { Streamdown } from "streamdown";

type ChatMarkdownProps = {
    className?: string;
    content: string;
};

export default function ChatMarkdown({ className, content }: ChatMarkdownProps) {
    return <Streamdown className={className}>{content}</Streamdown>;
}
