"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

interface CommentDTO {
  id: string;
  findingId: string;
  actor: string;
  body: string;
  createdAt: string;
}

interface AssignmentDTO {
  id: string;
  findingId: string;
  assignee: string;
  actor: string;
  assignedAt: string;
}

interface CollaborationPanelProps {
  findingId: string;
  /** Current assignee email or null if unassigned */
  currentAssignee?: string | null;
  /** Current user identity for actor field */
  currentActor?: string;
}

/**
 * Collaboration panel for a finding.
 *
 * Shows current assignee with an unassign button, an assign form,
 * a comment list, and an add-comment form.
 *
 * @param findingId - The finding's primary key
 * @param currentAssignee - Current assignee email or null
 * @param currentActor - The current user's identity (defaults to 'user')
 */
export function CollaborationPanel({
  findingId,
  currentAssignee: initialAssignee = null,
  currentActor = "user",
}: CollaborationPanelProps) {
  const [assignee, setAssignee] = useState<string | null>(initialAssignee);
  const [assignInput, setAssignInput] = useState("");
  const [comments, setComments] = useState<CommentDTO[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [assignLoading, setAssignLoading] = useState(false);
  const [commentLoading, setCommentLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadComments = useCallback(async () => {
    try {
      const res = await fetch(`/api/findings/${findingId}/comments`);
      const body = (await res.json()) as {
        success: boolean;
        data?: CommentDTO[];
      };
      if (body.success && body.data) {
        setComments(body.data);
      }
    } catch {
      // Ignore network errors on initial load
    }
  }, [findingId]);

  useEffect(() => {
    void loadComments();
  }, [loadComments]);

  async function handleAssign() {
    if (!assignInput.trim() || assignLoading) return;
    setAssignLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: assignInput.trim(), actor: currentActor }),
      });
      const body = (await res.json()) as {
        success: boolean;
        data?: AssignmentDTO;
        error?: { message: string };
      };
      if (body.success) {
        setAssignee(assignInput.trim());
        setAssignInput("");
      } else {
        setError(body.error?.message ?? "Assignment failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleUnassign() {
    if (assignLoading) return;
    setAssignLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/assignment`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assignee: null, actor: currentActor }),
      });
      const body = (await res.json()) as { success: boolean };
      if (body.success) {
        setAssignee(null);
      }
    } catch {
      setError("Network error");
    } finally {
      setAssignLoading(false);
    }
  }

  async function handleAddComment() {
    if (!commentBody.trim() || commentLoading) return;
    setCommentLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/findings/${findingId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ body: commentBody.trim(), actor: currentActor }),
      });
      const body = (await res.json()) as {
        success: boolean;
        data?: CommentDTO;
        error?: { message: string };
      };
      if (body.success && body.data) {
        setComments((prev) => [...prev, body.data!]);
        setCommentBody("");
      } else {
        setError(body.error?.message ?? "Comment failed");
      }
    } catch {
      setError("Network error");
    } finally {
      setCommentLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">Collaboration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-xs text-red-500">{error}</p>}

        {/* Assignment section */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Assignee
          </p>
          {assignee ? (
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{assignee}</Badge>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={handleUnassign}
                disabled={assignLoading}
              >
                Unassign
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                placeholder="Assign to email…"
                value={assignInput}
                onChange={(e) => setAssignInput(e.target.value)}
                className="h-7 text-xs"
                onKeyDown={(e) => e.key === "Enter" && void handleAssign()}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7"
                onClick={handleAssign}
                disabled={assignLoading || !assignInput.trim()}
              >
                Assign
              </Button>
            </div>
          )}
        </div>

        {/* Comments section */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Comments ({comments.length})
          </p>

          {comments.length > 0 && (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {comments.map((c) => (
                <div key={c.id} className="rounded border border-border p-2 bg-muted/30">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[11px] font-medium">{c.actor}</span>
                    <span className="text-[10px] text-muted-foreground">
                      {new Date(c.createdAt).toLocaleDateString()}
                    </span>
                  </div>
                  <p className="text-xs">{c.body}</p>
                </div>
              ))}
            </div>
          )}

          {/* Add comment */}
          <div className="space-y-2">
            <Textarea
              placeholder="Add a comment…"
              value={commentBody}
              onChange={(e) => setCommentBody(e.target.value)}
              className="text-xs min-h-[60px]"
            />
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddComment}
              disabled={commentLoading || !commentBody.trim()}
            >
              {commentLoading ? "Posting…" : "Post comment"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
