"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useWorkspace } from "@/lib/workspace";
import { NewProjectDialog, SettingsDialog } from "./dialogs";
import {
  IconAlert,
  IconClose,
  IconHome,
  IconLibrary,
  IconMenu,
  IconPlus,
  IconSearch,
  IconSettings,
  IconSidebar,
} from "./icons";

/**
 * The application shell: a quiet sidebar and one content column.
 *
 * Navigation is real routing, so every surface has an address: / for the
 * workspace home, /p/<id> for a project, /p/<id>/paper/<sourceId> for the
 * reader, /library for the cross-project document list.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const ws = useWorkspace();
  const pathname = usePathname();
  const router = useRouter();
  const [newProject, setNewProject] = useState(false);
  const [settings, setSettings] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const [query, setQuery] = useState("");

  const collapsed = ws.prefs.sidebarCollapsed ?? false;

  // A stored theme wins over the system setting; "system" removes the attribute.
  useEffect(() => {
    const root = document.documentElement;
    const theme = ws.prefs.theme ?? "system";
    if (theme === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", theme);
    root.setAttribute("data-density", ws.prefs.density ?? "comfortable");
  }, [ws.prefs.theme, ws.prefs.density]);

  // Route changes close the mobile drawer.
  useEffect(() => setDrawer(false), [pathname]);

  // Any surface can ask for Settings without threading a prop through the tree.
  useEffect(() => {
    const open = () => setSettings(true);
    document.addEventListener("paplora:settings", open);
    return () => document.removeEventListener("paplora:settings", open);
  }, []);

  const searchable = ws.projects.length > 7;
  const projects = query.trim()
    ? ws.projects.filter((p) => p.title.toLowerCase().includes(query.trim().toLowerCase()))
    : ws.projects;

  const wide = !collapsed || drawer;

  return (
    <div className="flex h-dvh overflow-hidden">
      {drawer ? (
        <div className="fixed inset-0 z-30 bg-black/30 lg:hidden" onClick={() => setDrawer(false)} aria-hidden />
      ) : null}

      <nav
        className={`${drawer ? "fixed inset-y-0 left-0 z-40 shadow-lg" : "hidden"} flex shrink-0 flex-col border-r lg:static lg:flex`}
        style={{
          width: wide ? 220 : 56,
          borderColor: "var(--border)",
          background: "var(--sidebar)",
        }}
        aria-label="Main"
      >
        <div className="flex h-12 items-center gap-1 px-2.5">
          {wide ? (
            <Link href="/" className="flex-1 truncate px-0.5 text-[15px] font-medium tracking-[-0.01em]">
              Paplora
            </Link>
          ) : null}
          <button
            className="btn btn-quiet btn-icon hidden lg:inline-flex"
            onClick={() => ws.setPrefs({ sidebarCollapsed: !collapsed })}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconSidebar />
          </button>
          <button className="btn btn-quiet btn-icon lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu">
            <IconClose />
          </button>
        </div>

        <div className="px-2.5 pb-2">
          <button
            className={`btn w-full ${wide ? "" : "btn-icon"}`}
            onClick={() => setNewProject(true)}
            aria-label="New project"
            title="New project"
          >
            <IconPlus />
            {wide ? <span>New project</span> : null}
          </button>
        </div>

        <div className="px-1.5 pb-1">
          <NavLink href="/" icon={<IconHome />} label="Home" wide={wide} active={pathname === "/"} />
          <NavLink
            href="/library"
            icon={<IconLibrary />}
            label="Library"
            wide={wide}
            active={pathname === "/library"}
            trailing={wide ? String(ws.library.length) : undefined}
          />
        </div>

        {searchable && wide ? (
          <div className="relative px-2.5 pb-1.5">
            <IconSearch
              size={14}
              className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2"
              style={{ color: "var(--text-3)" }}
            />
            <input
              className="field pl-7"
              placeholder="Find project"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Find project"
            />
          </div>
        ) : null}

        <div className="scroll-area min-h-0 flex-1 overflow-y-auto px-1.5">
          {wide ? (
            <p className="px-2 pb-1 pt-2 text-[11px] font-medium uppercase tracking-wide" style={{ color: "var(--text-3)" }}>
              Projects
            </p>
          ) : null}
          {projects.length === 0 ? (
            wide ? (
              <p className="px-2 text-[12.5px]" style={{ color: "var(--text-3)" }}>
                {ws.projects.length ? "No match." : "None yet."}
              </p>
            ) : null
          ) : (
            <ul className="space-y-px">
              {projects.map((project) => {
                const active = pathname.startsWith(`/p/${project.id}`);
                return (
                  <li key={project.id}>
                    <Link
                      href={`/p/${project.id}`}
                      className="relative flex items-center gap-2 rounded-md px-2 py-1.5 text-[13px]"
                      style={{
                        background: active ? "var(--accent-weak)" : "transparent",
                        color: active ? "var(--accent)" : "var(--text)",
                        fontWeight: active ? 500 : 400,
                      }}
                      title={project.title}
                    >
                      {wide ? (
                        <span className="min-w-0 flex-1 truncate">{project.title}</span>
                      ) : (
                        <span className="mx-auto text-[11.5px] font-medium uppercase">{project.title.slice(0, 2)}</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="p-1.5">
          <button className={`menu-item ${wide ? "" : "justify-center"}`} onClick={() => setSettings(true)} title="Settings">
            <IconSettings />
            {wide ? <span>Settings</span> : null}
          </button>
        </div>
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-12 shrink-0 items-center gap-2 border-b px-3 lg:hidden" style={{ borderColor: "var(--border)" }}>
          <button className="btn btn-quiet btn-icon" onClick={() => setDrawer(true)} aria-label="Open menu">
            <IconMenu />
          </button>
          <span className="text-[14px] font-medium">Paplora</span>
        </div>

        {ws.storageError ? (
          <div
            className="flex items-start gap-2 border-b px-4 py-2 text-[12.5px]"
            role="alert"
            style={{ borderColor: "var(--border)", background: "var(--danger-weak)", color: "var(--danger)" }}
          >
            <IconAlert size={15} />
            <span>{ws.storageError}</span>
          </div>
        ) : null}

        <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
      </div>

      <NewProjectDialog
        open={newProject}
        onOpenChange={setNewProject}
        onCreated={(project) => router.push(`/p/${project.id}`)}
      />
      <SettingsDialog open={settings} onOpenChange={setSettings} />
    </div>
  );
}

function NavLink({
  href,
  icon,
  label,
  wide,
  active,
  trailing,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  wide: boolean;
  active: boolean;
  trailing?: string;
}) {
  return (
    <Link
      href={href}
      className={`menu-item ${wide ? "" : "justify-center"}`}
      style={{
        background: active ? "var(--accent-weak)" : "transparent",
        color: active ? "var(--accent)" : "var(--text)",
      }}
      title={label}
    >
      {icon}
      {wide ? (
        <>
          <span className="flex-1">{label}</span>
          {trailing ? (
            <span className="text-[11.5px]" style={{ color: "var(--text-3)" }}>
              {trailing}
            </span>
          ) : null}
        </>
      ) : null}
    </Link>
  );
}
