"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type User = {
  id: string;
  name: string;
  access_code: string;
  role: string;
};

type Employee = {
  id: string;
  name: string;
  access_code: string;
  role: string;
  created_at: string;
};

function generateCode(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export default function AdminPage() {
  const router = useRouter();
  const supabase = createClient();

  const [user, setUser] = useState<User | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);

  // Add form
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState<"employee" | "admin">("employee");
  const [generatedCode, setGeneratedCode] = useState("");

  // Edit
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editRole, setEditRole] = useState<"employee" | "admin">("employee");

  useEffect(() => {
    const saved = localStorage.getItem("timeglass_user");
    if (!saved) {
      router.push("/");
      return;
    }
    const parsed = JSON.parse(saved);
    if (parsed.role !== "admin") {
      router.push("/timer");
      return;
    }
    setUser(parsed);
    loadEmployees();
  }, [router]);

  const loadEmployees = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("employees")
      .select("*")
      .order("name");
    if (data) setEmployees(data);
    setLoading(false);
  };

  const handleAdd = async () => {
    if (!newName.trim()) return;
    const code = generatedCode || generateCode();

    const { error } = await supabase.from("employees").insert({
      name: newName.trim(),
      access_code: code,
      role: newRole,
    });

    if (error) {
      alert("Error: " + error.message);
      return;
    }

    setNewName("");
    setNewRole("employee");
    setGeneratedCode("");
    loadEmployees();
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete ${name}?`)) return;
    await supabase.from("employees").delete().eq("id", id);
    loadEmployees();
  };

  const startEdit = (emp: Employee) => {
    setEditingId(emp.id);
    setEditName(emp.name);
    setEditCode(emp.access_code);
    setEditRole(emp.role as "employee" | "admin");
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await supabase
      .from("employees")
      .update({
        name: editName.trim(),
        access_code: editCode.trim().toUpperCase(),
        role: editRole,
      })
      .eq("id", editingId);
    setEditingId(null);
    loadEmployees();
  };

  const handleGenerateNewCode = (id: string) => {
    const code = generateCode();
    setEditCode(code);
  };

  if (!user) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-white/40">Loading...</p>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col px-4 py-5 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-5 shrink-0">
        <div>
          <p className="text-white/30 text-[11px] uppercase tracking-widest">Admin Panel</p>
          <p className="font-medium">{user.name}</p>
        </div>
        <button
          onClick={() => router.push("/timer")}
          className="text-sm px-3 py-1.5 rounded-xl"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          Back to Timer
        </button>
      </div>

      {/* Add new employee */}
      <div 
        className="rounded-2xl p-4 mb-4 shrink-0"
        style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.08)" }}
      >
        <p className="text-white/50 text-xs uppercase tracking-wider mb-3">Add Employee</p>
        
        <input
          type="text"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          placeholder="Name"
          className="w-full mb-2 px-3 py-2.5 rounded-xl outline-none text-sm"
          style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
        />

        <div className="flex gap-2 mb-2">
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as "employee" | "admin")}
            className="flex-1 px-3 py-2.5 rounded-xl outline-none text-sm bg-transparent"
            style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
          >
            <option value="employee">Employee</option>
            <option value="admin">Admin</option>
          </select>

          <button
            onClick={() => setGeneratedCode(generateCode())}
            className="px-3 py-2.5 rounded-xl text-sm"
            style={{ background: "rgba(255,255,255,0.08)" }}
          >
            Generate Code
          </button>
        </div>

        {generatedCode && (
          <div className="mb-2 px-3 py-2 rounded-xl text-sm font-mono tracking-wider"
            style={{ background: "rgba(124,58,237,0.2)", border: "1px solid rgba(124,58,237,0.4)" }}>
            {generatedCode}
          </div>
        )}

        <button
          onClick={handleAdd}
          disabled={!newName.trim()}
          className="w-full py-2.5 rounded-xl text-sm font-medium disabled:opacity-40"
          style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}
        >
          Add Employee
        </button>
      </div>

      {/* Employees list */}
      <div className="flex-1 overflow-y-auto space-y-2 pr-1" style={{ overscrollBehavior: "contain" }}>
        <p className="text-white/50 text-xs uppercase tracking-wider mb-2 sticky top-0 bg-[#0a0a0f] py-1">
          Employees ({employees.length})
        </p>

        {loading ? (
          <p className="text-white/30 text-sm">Loading...</p>
        ) : (
          employees.map((emp) => (
            <div
              key={emp.id}
              className="rounded-xl p-3"
              style={{ background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.06)" }}
            >
              {editingId === emp.id ? (
                <div className="space-y-2">
                  <input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  />
                  <div className="flex gap-2">
                    <input
                      value={editCode}
                      onChange={(e) => setEditCode(e.target.value.toUpperCase())}
                      className="flex-1 px-3 py-2 rounded-lg outline-none text-sm font-mono"
                      style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                    />
                    <button
                      onClick={() => handleGenerateNewCode(emp.id)}
                      className="px-3 py-2 rounded-lg text-xs"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      New
                    </button>
                  </div>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as "employee" | "admin")}
                    className="w-full px-3 py-2 rounded-lg outline-none text-sm"
                    style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
                  >
                    <option value="employee">Employee</option>
                    <option value="admin">Admin</option>
                  </select>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="flex-1 py-2 rounded-lg text-sm"
                      style={{ background: "rgba(255,255,255,0.06)" }}
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      className="flex-1 py-2 rounded-lg text-sm font-medium"
                      style={{ background: "linear-gradient(135deg, #7c3aed 0%, #06b6d4 100%)" }}
                    >
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{emp.name}</p>
                    <p className="text-white/40 text-xs font-mono tracking-wider mt-0.5">{emp.access_code}</p>
                    <p className="text-white/30 text-[10px] uppercase mt-1">{emp.role}</p>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => startEdit(emp)}
                      className="px-3 py-1.5 rounded-lg text-xs"
                      style={{ background: "rgba(255,255,255,0.08)" }}
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(emp.id, emp.name)}
                      className="px-3 py-1.5 rounded-lg text-xs text-red-300"
                      style={{ background: "rgba(239,68,68,0.15)" }}
                    >
                      Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
