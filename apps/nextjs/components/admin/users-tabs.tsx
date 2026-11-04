"use client";

import { UserRound, Plug } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UsersTable, type AdminUserRow } from "@/components/admin/users-table";
import {
  AppUsersTable,
  type AppUserRow,
} from "@/components/admin/app-users-table";

// Onglets de /admin/users (RBAC refonte - spec fonctionnelle § « Rôles et Permissions ») : comptes
// humains d'un côté, comptes applicatifs (outils data) de l'autre.

export function AdminUsersTabs({
  users,
  appUsers,
  roles,
}: {
  users: AdminUserRow[];
  appUsers: AppUserRow[];
  roles: { id: string; name: string; key: string }[];
}) {
  return (
    <Tabs defaultValue="humans">
      <TabsList>
        <TabsTrigger value="humans">
          <UserRound className="h-4 w-4" strokeWidth={1.6} /> Humains
          <span className="mono ml-1 text-[10px] text-muted-foreground">
            {users.length}
          </span>
        </TabsTrigger>
        <TabsTrigger value="app">
          <Plug className="h-4 w-4" strokeWidth={1.6} /> Applicatifs
          <span className="mono ml-1 text-[10px] text-muted-foreground">
            {appUsers.length}
          </span>
        </TabsTrigger>
      </TabsList>
      <TabsContent value="humans">
        <UsersTable users={users} roles={roles} />
      </TabsContent>
      <TabsContent value="app">
        <AppUsersTable appUsers={appUsers} roles={roles} />
      </TabsContent>
    </Tabs>
  );
}
