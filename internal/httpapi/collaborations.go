package httpapi

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"slices"
	"time"

	"github.com/jackc/pgx/v5"
)

// Collaboration is an invitation as its chart's owners see it. An accepted
// recipient may have left since; the record keeps what they answered.
// RespondedAt is when it was answered or revoked; RevokedBy who revoked it.
type Collaboration struct {
	ID          string             `json:"id"`
	Status      string             `json:"status"`
	CreatedAt   time.Time          `json:"createdAt"`
	RespondedAt *time.Time         `json:"respondedAt"`
	Inviter     *NotificationActor `json:"inviter"`
	Recipient   *NotificationActor `json:"recipient"`
	RevokedBy   *NotificationActor `json:"revokedBy"`
}

// listCollaborations shows a chart's owners every invitation sent for it, so
// an invitation is not lost once the dialog that sent it closes. Pending ones
// come first, then the most recent; older history is cut at 100.
func (s *Server) listCollaborations(w http.ResponseWriter, r *http.Request) {
	u, ok := s.required(w, r, false)
	if !ok {
		return
	}
	ctx := r.Context()
	var owners []string
	e := s.DB.QueryRow(ctx, `SELECT owner_ids FROM charts c WHERE c.id=$1 AND `+publishedChart, r.PathValue("id")).Scan(&owners)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "CHART_NOT_FOUND", "作品不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	if !slices.Contains(owners, u.User.ID) {
		problem(w, 403, "FORBIDDEN", "只有所有者可以查看邀请")
		return
	}
	rows, e := s.DB.Query(ctx, `SELECT id,status,created_at,responded_at,inviter_id,recipient_id,revoked_by FROM chart_collaborations
 WHERE chart_id=$1 ORDER BY status='pending' DESC,created_at DESC,id LIMIT 100`, r.PathValue("id"))
	if e != nil {
		internal(w, e)
		return
	}
	items := []Collaboration{}
	users := []string{}
	for rows.Next() {
		var c Collaboration
		var inviter, recipient string
		var revoker *string
		if e = rows.Scan(&c.ID, &c.Status, &c.CreatedAt, &c.RespondedAt, &inviter, &recipient, &revoker); e != nil {
			rows.Close()
			internal(w, e)
			return
		}
		c.Inviter, c.Recipient = &NotificationActor{ID: inviter}, &NotificationActor{ID: recipient}
		users = append(users, inviter, recipient)
		if revoker != nil {
			c.RevokedBy = &NotificationActor{ID: *revoker}
			users = append(users, *revoker)
		}
		items = append(items, c)
	}
	e = rows.Err()
	rows.Close()
	if e != nil {
		internal(w, e)
		return
	}
	if len(users) > 0 {
		profiles := s.publicProfiles(ctx, users)
		for _, c := range items {
			for _, a := range []*NotificationActor{c.Inviter, c.Recipient, c.RevokedBy} {
				if a == nil {
					continue
				}
				p := profiles[a.ID]
				a.Nickname, a.AvatarURL = p.Nickname, p.AvatarURL
			}
		}
	}
	respond(w, 200, map[string][]Collaboration{"items": items})
}

// invitationsPerDay bounds the new invitations one user sends in a day, on all charts together.
const invitationsPerDay = 20

// lockInvitations serializes the per-sender limit across different charts without taking a user lock.
func lockInvitations(ctx context.Context, tx pgx.Tx, inviter string) error {
	_, e := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1,37))`, inviter)
	return e
}

// invitationsLeft is how many more invitations inviter may send today.
func invitationsLeft(ctx context.Context, db rowScanner, inviter string) (left int, e error) {
	e = db.QueryRow(ctx, `SELECT $2-count(*) FROM chart_collaborations WHERE inviter_id=$1 AND created_at>now()-interval '1 day'`, inviter, invitationsPerDay).Scan(&left)
	return
}

func sendInvitation(ctx context.Context, tx pgx.Tx, chart, inviter, recipient string) (string, error) {
	invitation := ID()
	_, e := tx.Exec(ctx, `INSERT INTO chart_collaborations(id,chart_id,inviter_id,recipient_id) VALUES($1,$2,$3,$4)`, invitation, chart, inviter, recipient)
	if e == nil {
		// Actionable invitations are always delivered, independently of social-notice mutes.
		_, e = tx.Exec(ctx, `INSERT INTO notifications(id,recipient_id,kind,actor_id,chart_id,collaboration_id) VALUES($1,$2,'chart_collaboration',$3,$4,$5)`, ID(), recipient, inviter, chart, invitation)
	}
	return invitation, e
}

// uploadCollaborators reads the co-creators chosen with a new upload, a JSON
// array of user IDs, and applies the checks of inviteCollaborator while the
// uploader is still there to be told. They are invited once the chart is published.
func (s *Server) uploadCollaborators(w http.ResponseWriter, r *http.Request, raw, uploader string) ([]string, bool) {
	if raw == "" {
		return nil, true
	}
	var ids []string
	if json.Unmarshal([]byte(raw), &ids) != nil {
		problem(w, 400, "USER_INVALID", "共同创作者必须为用户 ID 数组")
		return nil, false
	}
	slices.Sort(ids)
	ids = slices.Compact(ids)
	if len(ids) == 0 {
		return nil, true
	}
	if slices.ContainsFunc(ids, func(id string) bool { return !validSubject(id) }) {
		problem(w, 400, "USER_INVALID", "请选择有效的用户")
		return nil, false
	}
	if slices.Contains(ids, uploader) {
		problem(w, 409, "ALREADY_OWNER", "你已经是所有者，不需要邀请自己")
		return nil, false
	}
	var known int
	if e := s.DB.QueryRow(r.Context(), `SELECT count(*) FROM users WHERE id=ANY($1)`, ids).Scan(&known); e != nil {
		internal(w, e)
		return nil, false
	}
	if known != len(ids) {
		problem(w, 404, "USER_NOT_FOUND", "用户尚未加入本站")
		return nil, false
	}
	left, e := invitationsLeft(r.Context(), s.DB, uploader)
	if e != nil {
		internal(w, e)
		return nil, false
	}
	if len(ids) > left {
		problem(w, 429, "RATE_LIMITED", "今天发送的邀请过多，请减少共同创作者或稍后再试")
		return nil, false
	}
	return ids, true
}

// inviteOnPublish sends a new chart's invitations in the transaction that
// publishes it. uploadCollaborators checked them when the upload was accepted;
// what changed while it waited is skipped rather than failing the upload: an
// account removed since, and invitations beyond the day's limit that other
// requests used up in the meantime.
func inviteOnPublish(ctx context.Context, tx pgx.Tx, chart, inviter string, recipients []string) error {
	if len(recipients) == 0 {
		return nil
	}
	if e := lockInvitations(ctx, tx, inviter); e != nil {
		return e
	}
	left, e := invitationsLeft(ctx, tx, inviter)
	if e != nil {
		return e
	}
	rows, e := tx.Query(ctx, `SELECT id FROM users WHERE id=ANY($1) ORDER BY id`, recipients)
	if e != nil {
		return e
	}
	present, e := pgx.CollectRows(rows, pgx.RowTo[string])
	if e != nil {
		return e
	}
	for _, recipient := range present[:max(0, min(left, len(present)))] {
		if _, e = sendInvitation(ctx, tx, chart, inviter, recipient); e != nil {
			return e
		}
	}
	return nil
}

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
	if e = lockInvitations(ctx, tx, u.User.ID); e != nil {
		internal(w, e)
		return
	}
	left, e := invitationsLeft(ctx, tx, u.User.ID)
	if e != nil {
		internal(w, e)
		return
	}
	if left < 1 {
		problem(w, 429, "RATE_LIMITED", "今天发送的邀请过多，请稍后再试")
		return
	}
	invitation, e = sendInvitation(ctx, tx, r.PathValue("id"), u.User.ID, req.UserID)
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 201, map[string]string{"id": invitation, "status": "pending"})
}

// revokeCollaboration lets any owner withdraw a pending invitation, theirs or
// another owner's. The record stays as revoked; the recipient's notice is
// marked read and shows the revocation, and can no longer be accepted.
func (s *Server) revokeCollaboration(w http.ResponseWriter, r *http.Request) {
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
	// The chart lock serializes this with the recipient accepting.
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
		problem(w, 403, "FORBIDDEN", "只有所有者可以撤回邀请")
		return
	}
	var status string
	e = tx.QueryRow(ctx, `SELECT status FROM chart_collaborations WHERE id=$1 AND chart_id=$2 FOR UPDATE`, r.PathValue("invitation"), r.PathValue("id")).Scan(&status)
	if errors.Is(e, pgx.ErrNoRows) {
		problem(w, 404, "INVITATION_NOT_FOUND", "邀请不存在")
		return
	}
	if e != nil {
		internal(w, e)
		return
	}
	switch status {
	case "revoked":
		respond(w, 200, map[string]string{"status": status})
		return
	case "pending":
	default:
		problem(w, 409, "INVITATION_RESOLVED", "对方已经回复，不能撤回")
		return
	}
	_, e = tx.Exec(ctx, `UPDATE chart_collaborations SET status='revoked',responded_at=now(),revoked_by=$2 WHERE id=$1`, r.PathValue("invitation"), u.User.ID)
	if e == nil {
		_, e = tx.Exec(ctx, `UPDATE notifications SET read_at=COALESCE(read_at,now()) WHERE collaboration_id=$1`, r.PathValue("invitation"))
	}
	if e == nil {
		e = tx.Commit(ctx)
	}
	if e != nil {
		internal(w, e)
		return
	}
	respond(w, 200, map[string]string{"status": "revoked"})
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
	if status == "revoked" {
		problem(w, 409, "INVITATION_REVOKED", "邀请已被撤回")
		return
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
