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
        width: "100vw",
        height: "100vh",
        maxWidth: "100vw",
        zIndex: 9999,
        overflow: "auto",
        background: "#000",
        margin: 0,
        padding: 0,
      }}
    >
      {children}
    </div>
  );
}
