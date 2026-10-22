package httpapi

import (
	"errors"
	"net/http"
	"slices"

	"github.com/jackc/pgx/v5"
)

// Invitations grant nothing until the recipient explicitly accepts. Every
// transition locks the chart first, serializing invitations, acceptance and deletion.
func (s *Server) inviteCollaborator(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var req struct {
		UserID string `json:"userId"`
	}
	if !decode(w, r, &req) {
		return
	}
	if !validSubject(req.UserID) {
		problem(w, 400, "USER_INVALID", "请选择有效的用户")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var owners []string
	e = tx.QueryRow(ctx, `SELECT owner_ids FROM charts c WHERE c.id=$1 AND `+publishedChart+` FOR UPDATE`, r.PathValue("id")).Scan(&owners)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if !slices.Contains(owners, u.User.ID) {
		problem(w, 403, "FORBIDDEN", "只有所有者可以邀请共同创作者")
		return
	}
	if slices.Contains(owners, req.UserID) {
		problem(w, 409, "ALREADY_OWNER", "该用户已经是所有者")
		return
	}
	var exists bool
	e = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1)`, req.UserID).Scan(&exists)
	if e != nil {
		internal(w, e)
		return
	}
	if !exists {
		problem(w, 404, "USER_NOT_FOUND", "用户尚未加入本站")
		return
	}
	var invitation string
	e = tx.QueryRow(ctx, `SELECT id FROM chart_collaborations WHERE chart_id=$1 AND recipient_id=$2 AND status='pending'`, r.PathValue("id"), req.UserID).Scan(&invitation)
	if e == nil {
		respond(w, 200, map[string]string{"id": invitation, "status": "pending"})
		return
	}
	if !errors.Is(e, pgx.ErrNoRows) {
		internal(w, e)
		return
	}
	// Serialize the per-sender limit across different charts without taking a user lock.
	if _, e = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,37))`, u.User.ID); e != nil {
		internal(w, e)
		return
	}
	var recent int
	if e = tx.QueryRow(ctx, `SELECT count(*) FROM chart_collaborations WHERE inviter_id=$1 AND created_at>now()-interval '1 day'`, u.User.ID).Scan(&recent); e != nil {
		internal(w, e)
		return
	}
	if recent >= 20 {
		problem(w, 429, "RATE_LIMITED", "今天发送的邀请过多，请稍后再试")
		return
	}
	invitation = ID()
	_, e = tx.Exec(ctx, `INSERT INTO chart_collaborations(id,chart_id,inviter_id,recipient_id) VALUES($1,$2,$3,$4)`, invitation, r.PathValue("id"), u.User.ID, req.UserID)
	if e == nil {
		// Actionable invitations are always delivered, independently of social-notice mutes.
		_, e = tx.Exec(ctx, `INSERT INTO notifications(id,recipient_id,kind,actor_id,chart_id,collaboration_id) VALUES($1,$2,'chart_collaboration',$3,$4,$5)`, ID(), req.UserID, u.User.ID, r.PathValue("id"), invitation)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 201, map[string]string{"id": invitation, "status": "pending"})
}

func (s *Server) respondCollaboration(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	var req struct {
		Accept *bool `json:"accept"`
	}
	if !decode(w, r, &req) {
		return
	}
	if req.Accept == nil {
		problem(w, 400, "REQUEST_INVALID", "缺少 accept")
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	var chartID, invitation string
	e = tx.QueryRow(ctx, `SELECT chart_id,collaboration_id FROM notifications WHERE id=$1 AND recipient_id=$2 AND kind='chart_collaboration'`, r.PathValue("id"), u.User.ID).Scan(&chartID, &invitation)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "NOTIFICATION_NOT_FOUND", "邀请不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	var owners []string
	e = tx.QueryRow(ctx, `SELECT owner_ids FROM charts c WHERE c.id=$1 AND `+publishedChart+` FOR UPDATE`, chartID).Scan(&owners)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	var status, inviter string
	e = tx.QueryRow(ctx, `SELECT status,inviter_id FROM chart_collaborations WHERE id=$1 AND recipient_id=$2 FOR UPDATE`, invitation, u.User.ID).Scan(&status, &inviter)
	if e != nil {
		internal(w, e)
		return
	}
	desired := "declined"
	if *req.Accept {
		desired = "accepted"
	}
	if status != "pending" && status != desired {
		problem(w, 409, "INVITATION_RESOLVED", "邀请已经处理")
		return
	}
	if status == "pending" {
		if *req.Accept {
			if !slices.Contains(owners, inviter) {
				problem(w, 409, "INVITATION_INVALID", "邀请者已不是所有者")
				return
			}
			if !slices.Contains(owners, u.User.ID) {
				_, e = tx.Exec(ctx, `UPDATE charts SET owner_ids=array_append(owner_ids,$2::text) WHERE id=$1`, chartID, u.User.ID)
			}
		}
		if e == nil {
			_, e = tx.Exec(ctx, `UPDATE chart_collaborations SET status=$2,responded_at=now() WHERE id=$1`, invitation, desired)
		}
	}
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND recipient_id=$2`, r.PathValue("id"), u.User.ID)
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 200, map[string]string{"status": desired})
}

// leaveChart lets an owner give up a co-owned chart. The last owner cannot
// leave: a chart always has an owner, and a sole owner deletes it instead.
func (s *Server) leaveChart(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, true)
	if !ok {
		return
	}
	ctx := r.Context()
	tx, e := s.DB.Begin(ctx)
	if e != nil {
		internal(w, e)
		return
	}
	defer tx.Rollback(ctx)
	// The chart lock serializes this with invitations being accepted and with
	// other owners leaving, so two owners cannot both leave a chart of two.
	var owners []string
	e = tx.QueryRow(ctx, `SELECT owner_ids FROM charts c WHERE c.id=$1 AND `+publishedChart+` FOR UPDATE`, r.PathValue("id")).Scan(&owners)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if !slices.Contains(owners, u.User.ID) {
		problem(w, 403, "FORBIDDEN", "你不是这个作品的所有者")
		return
	}
	if len(owners) < 2 {
		problem(w, 409, "LAST_OWNER", "你是唯一的所有者，不能放弃；如不再需要可以删除作品")
		return
	}
	e = tx.QueryRow(ctx, `UPDATE charts SET owner_ids=array_remove(owner_ids,$2::text) WHERE id=$1 RETURNING owner_ids`, r.PathValue("id"), u.User.ID).Scan(&owners)
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 200, map[string][]string{"ownerIds": owners})
}
