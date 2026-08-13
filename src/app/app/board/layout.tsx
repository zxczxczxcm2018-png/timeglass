export default function BoardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 9999,
        overflow: "auto",
        background: "#000",
      }}
    >
      {children}
    </div>
  );
}
