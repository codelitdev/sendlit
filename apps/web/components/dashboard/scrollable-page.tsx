export function ScrollablePage({ children }: { children: React.ReactNode }) {
    return <div className="flex-1 overflow-y-auto p-8">{children}</div>;
}
