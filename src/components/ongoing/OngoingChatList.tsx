import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  getOngoingChats,
  createOngoingChat,
  updateOngoingChatMeta,
  deleteOngoingChat,
} from "@/services/storage";
import type { OngoingChat } from "@/types";
import { Plus, Pencil, Trash2, MessageSquare, Check, X } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface OngoingChatListProps {
  onSelectChat: (chatId: string) => void;
}

const DEFAULT_PERSONAS = [
  { name: "Yuki", persona: "A university student in Tokyo who loves anime, cooking, and going to cafés" },
  { name: "Kenji", persona: "A laid-back surfer from Shonan who works at a local izakaya" },
  { name: "Sakura", persona: "An office worker in Osaka who is into fashion and travel" },
];

export function OngoingChatList({ onSelectChat }: OngoingChatListProps) {
  const [chats, setChats] = useState<OngoingChat[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChat, setEditingChat] = useState<OngoingChat | null>(null);
  const [name, setName] = useState("");
  const [persona, setPersona] = useState("");

  useEffect(() => {
    getOngoingChats().then(setChats);
  }, []);

  const refreshChats = async () => {
    const list = await getOngoingChats();
    setChats(list);
  };

  const openCreateDialog = () => {
    setEditingChat(null);
    setName("");
    setPersona("");
    setDialogOpen(true);
  };

  const openEditDialog = (e: React.MouseEvent, chat: OngoingChat) => {
    e.stopPropagation();
    setEditingChat(chat);
    setName(chat.name);
    setPersona(chat.persona);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    const trimmedPersona = persona.trim();
    if (!trimmedName || !trimmedPersona) return;

    if (editingChat) {
      await updateOngoingChatMeta(editingChat.id, { name: trimmedName, persona: trimmedPersona });
    } else {
      await createOngoingChat(trimmedName, trimmedPersona);
    }
    await refreshChats();
    setDialogOpen(false);
  };

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const handleDeleteClick = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setConfirmDeleteId(id);
  };

  const handleDeleteConfirm = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await deleteOngoingChat(id);
    setConfirmDeleteId(null);
    await refreshChats();
  };

  const handleDeleteCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmDeleteId(null);
  };

  const handleQuickCreate = async (preset: typeof DEFAULT_PERSONAS[number]) => {
    await createOngoingChat(preset.name, preset.persona);
    await refreshChats();
    setDialogOpen(false);
  };

  const sortedChats = [...chats].sort(
    (a, b) => b.lastActiveAt.localeCompare(a.lastActiveAt)
  );

  return (
    <div className="flex flex-col h-full max-w-2xl mx-auto p-4">
      <div className="flex items-center justify-end mb-4">
        <Button size="sm" onClick={openCreateDialog}>
          <Plus className="size-4 mr-1" />
          New Conversation
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto">
        <div className="grid gap-3 pb-4">
          {sortedChats.map((chat) => (
            <Card
              key={chat.id}
              className="cursor-pointer transition-colors hover:border-primary/50 py-0 gap-0"
              onClick={() => onSelectChat(chat.id)}
            >
              <CardContent className="py-2.5 px-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2 flex-wrap">
                      <h3 className="font-medium">{chat.name}</h3>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(chat.lastActiveAt), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1 line-clamp-1">
                      {chat.persona}
                    </p>
                    <div className="flex gap-2 mt-2">
                      <Badge variant="secondary" className="text-xs">
                        <MessageSquare className="size-3 mr-1" />
                        {chat.totalMessages} messages
                      </Badge>
                      {chat.summary && (
                        <Badge variant="secondary" className="text-xs">
                          Has history
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {confirmDeleteId === chat.id ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteConfirm(e, chat.id)}
                          title="Confirm delete"
                        >
                          <Check className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={handleDeleteCancel}
                          title="Cancel"
                        >
                          <X className="size-3.5" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8"
                          onClick={(e) => openEditDialog(e, chat)}
                        >
                          <Pencil className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 text-destructive hover:text-destructive"
                          onClick={(e) => handleDeleteClick(e, chat.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}

          {chats.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <MessageSquare className="size-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No ongoing chats yet</p>
              <p className="text-sm mt-1">
                Create a chat partner to start a persistent conversation
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {editingChat ? "Edit Chat" : "New Ongoing Chat"}
            </DialogTitle>
            <DialogDescription>
              {editingChat
                ? "Update your chat partner's details."
                : "Create a conversation partner for persistent practice."}
            </DialogDescription>
          </DialogHeader>

          {!editingChat && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Quick start</p>
              <div className="grid gap-2">
                {DEFAULT_PERSONAS.map((p) => (
                  <button
                    key={p.name}
                    className="text-left p-3 rounded-lg border hover:border-primary/50 transition-colors"
                    onClick={() => handleQuickCreate(p)}
                  >
                    <span className="font-medium">{p.name}</span>
                    <span className="text-sm text-muted-foreground block mt-0.5">
                      {p.persona}
                    </span>
                  </button>
                ))}
              </div>
              <div className="relative py-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">or custom</span>
                </div>
              </div>
            </div>
          )}

          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name</label>
              <Input
                placeholder="e.g. Yuki, Tanaka-san"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Persona</label>
              <Textarea
                placeholder="Describe their personality, interests, and background..."
                value={persona}
                onChange={(e) => setPersona(e.target.value)}
                rows={3}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={!name.trim() || !persona.trim()}
            >
              {editingChat ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
