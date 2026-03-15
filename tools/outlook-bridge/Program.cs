using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Microsoft.Office.Interop.Outlook;
using Application = Microsoft.Office.Interop.Outlook.Application;

// CLI tool that reads from local Outlook via COM and outputs JSON.
// Usage:
//   outlook-bridge emails [count]
//   outlook-bridge calendar-today
//   outlook-bridge calendar-upcoming [days]
//   outlook-bridge search-email <query> [count]

class Program
{
    static readonly JsonSerializerOptions JsonOpts = new JsonSerializerOptions
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false
    };

    [STAThread]
    static int Main(string[] args)
    {
        if (args.Length == 0)
        {
            Console.Error.WriteLine("Usage: outlook-bridge <command> [args]");
            return 1;
        }

        try
        {
            var app = new Application();
            var ns = app.GetNamespace("MAPI");

            switch (args[0])
            {
                case "emails":
                    int emailCount = args.Length > 1 && int.TryParse(args[1], out var ec) ? ec : 30;
                    Console.Write(GetEmails(ns, emailCount));
                    break;
                case "calendar-today":
                    Console.Write(GetCalendar(ns, DateTime.Today, DateTime.Today.AddDays(1)));
                    break;
                case "calendar-upcoming":
                    int days = args.Length > 1 && int.TryParse(args[1], out var d) ? d : 7;
                    Console.Write(GetCalendar(ns, DateTime.Now, DateTime.Now.AddDays(days)));
                    break;
                case "folders":
                    var inbox = ns.GetDefaultFolder(OlDefaultFolders.olFolderInbox);
                    Console.Write(GetFolderTree(inbox));
                    break;
                case "folder-emails":
                    string folderPath = args.Length > 1 ? args[1] : "Inbox";
                    int folderCount = args.Length > 2 && int.TryParse(args[2], out var fc) ? fc : 30;
                    Console.Write(GetFolderEmails(ns, folderPath, folderCount));
                    break;
                case "email-body":
                    string entryId = args.Length > 1 ? args[1] : "";
                    Console.Write(GetEmailBody(ns, entryId));
                    break;
                case "search-email":
                    string query = args.Length > 1 ? args[1] : "";
                    int searchCount = args.Length > 2 && int.TryParse(args[2], out var sc) ? sc : 20;
                    Console.Write(SearchEmails(ns, query, searchCount));
                    break;
                case "open-draft":
                    // args: open-draft "to" "subject" "htmlBody" ["cc"]
                    string to = args.Length > 1 ? args[1] : "";
                    string subject = args.Length > 2 ? args[2] : "";
                    string body = args.Length > 3 ? args[3] : "";
                    string cc = args.Length > 4 ? args[4] : "";
                    OpenDraft(app, to, subject, body, cc);
                    Console.Write(JsonSerializer.Serialize(new { success = true, message = "Draft opened in Outlook" }, JsonOpts));
                    break;
                default:
                    Console.Error.WriteLine("Unknown command: " + args[0]);
                    return 1;
            }
            return 0;
        }
        catch (System.Exception ex)
        {
            Console.Error.WriteLine("Error: " + ex.Message);
            Console.Write(JsonSerializer.Serialize(new { error = ex.Message }, JsonOpts));
            return 1;
        }
    }

    static string GetEmails(NameSpace ns, int count)
    {
        var inbox = ns.GetDefaultFolder(OlDefaultFolders.olFolderInbox);
        var allMails = new List<MailItem>();
        CollectMails(inbox, allMails, count * 3); // collect extra, then sort & trim

        // Sort by received time descending, take top N
        allMails.Sort((a, b) =>
        {
            try { return b.ReceivedTime.CompareTo(a.ReceivedTime); }
            catch { return 0; }
        });

        var results = new List<object>();
        foreach (var mail in allMails.Take(count))
        {
            results.Add(new
            {
                id = Safe(() => mail.EntryID) ?? "",
                subject = Safe(() => mail.Subject) ?? "(no subject)",
                fromName = Safe(() => mail.SenderName) ?? "Unknown",
                fromEmail = Safe(() => mail.SenderEmailAddress) ?? "",
                receivedAt = Safe(() => mail.ReceivedTime.ToString("o")) ?? "",
                bodyPreview = Safe(() => mail.Body != null && mail.Body.Length > 200 ? mail.Body.Substring(0, 200) : mail.Body) ?? "",
                isRead = !SafeBool(() => mail.UnRead),
                importance = Safe(() => mail.Importance.ToString().ToLower()) ?? "normal"
            });
        }
        return JsonSerializer.Serialize(results, JsonOpts);
    }

    static void CollectMails(MAPIFolder folder, List<MailItem> results, int max)
    {
        try
        {
            var items = folder.Items;
            items.Sort("[ReceivedTime]", true);
            foreach (var raw in items)
            {
                if (results.Count >= max) return;
                if (raw is MailItem mail) results.Add(mail);
            }
        }
        catch { }

        try
        {
            foreach (MAPIFolder sub in folder.Folders)
            {
                if (results.Count >= max) return;
                CollectMails(sub, results, max);
            }
        }
        catch { }
    }

    static void OpenDraft(Application app, string to, string subject, string htmlBody, string cc)
    {
        var mail = (MailItem)app.CreateItem(OlItemType.olMailItem);
        if (!string.IsNullOrEmpty(to)) mail.To = to;
        if (!string.IsNullOrEmpty(cc)) mail.CC = cc;
        if (!string.IsNullOrEmpty(subject)) mail.Subject = subject;
        if (!string.IsNullOrEmpty(htmlBody)) mail.HTMLBody = htmlBody;
        mail.Display(false); // Opens the compose window
    }

    static string SearchEmails(NameSpace ns, string query, int count)
    {
        var inbox = ns.GetDefaultFolder(OlDefaultFolders.olFolderInbox);
        var allMails = new List<MailItem>();
        CollectMails(inbox, allMails, count * 5);

        var q = (query ?? "").ToLowerInvariant();
        var results = new List<object>();

        // Sort newest first
        allMails.Sort((a, b) =>
        {
            try { return b.ReceivedTime.CompareTo(a.ReceivedTime); }
            catch { return 0; }
        });

        foreach (var mail in allMails)
        {
            if (results.Count >= count) break;
            var subject = Safe(() => mail.Subject) ?? "";
            var from = Safe(() => mail.SenderName) ?? "";

            if (subject.ToLowerInvariant().Contains(q) || from.ToLowerInvariant().Contains(q))
            {
                results.Add(new
                {
                    id = Safe(() => mail.EntryID) ?? "",
                    subject,
                    fromName = from,
                    fromEmail = Safe(() => mail.SenderEmailAddress) ?? "",
                    receivedAt = Safe(() => mail.ReceivedTime.ToString("o")) ?? "",
                    bodyPreview = Safe(() => mail.Body != null && mail.Body.Length > 200 ? mail.Body.Substring(0, 200) : mail.Body) ?? "",
                    isRead = !SafeBool(() => mail.UnRead),
                    importance = Safe(() => mail.Importance.ToString().ToLower()) ?? "normal"
                });
            }
        }
        return JsonSerializer.Serialize(results, JsonOpts);
    }

    static string GetCalendar(NameSpace ns, DateTime start, DateTime end)
    {
        var calFolder = ns.GetDefaultFolder(OlDefaultFolders.olFolderCalendar);
        var items = calFolder.Items;
        items.Sort("[Start]", false);
        items.IncludeRecurrences = true;

        var filter = string.Format("[Start] >= '{0}' AND [End] <= '{1}'", start.ToString("g"), end.ToString("g"));
        var filtered = items.Restrict(filter);

        var results = new List<object>();
        foreach (var raw in filtered)
        {
            if (raw is AppointmentItem appt)
            {
                DateTime st, et;
                try { st = appt.Start; et = appt.End; }
                catch { continue; }
                if (st < start || st > end) continue;

                var attendees = new List<string>();
                try
                {
                    foreach (Recipient r in appt.Recipients)
                    {
                        var name = Safe(() => r.Name);
                        if (!string.IsNullOrWhiteSpace(name)) attendees.Add(name);
                    }
                }
                catch { }

                results.Add(new
                {
                    subject = Safe(() => appt.Subject) ?? "",
                    start = st.ToString("o"),
                    end = et.ToString("o"),
                    organizer = Safe(() => appt.Organizer) ?? "",
                    location = Safe(() => appt.Location) ?? "",
                    isOnline = (Safe(() => appt.Location) ?? "").Contains("Teams"),
                    attendeeCount = attendees.Count,
                    attendees = attendees.Take(10).ToList()
                });
            }
        }
        return JsonSerializer.Serialize(results, JsonOpts);
    }

    static string GetFolderTree(MAPIFolder root)
    {
        var tree = BuildFolderNode(root);
        return JsonSerializer.Serialize(tree, JsonOpts);
    }

    static object BuildFolderNode(MAPIFolder folder)
    {
        var children = new List<object>();
        try
        {
            foreach (MAPIFolder sub in folder.Folders)
            {
                children.Add(BuildFolderNode(sub));
            }
        }
        catch { }

        int count = 0;
        int unread = 0;
        try { count = folder.Items.Count; } catch { }
        try { unread = folder.UnReadItemCount; } catch { }

        return new
        {
            name = Safe(() => folder.Name) ?? "",
            path = Safe(() => folder.FolderPath) ?? "",
            count,
            unread,
            children
        };
    }

    static string GetFolderEmails(NameSpace ns, string folderPath, int count)
    {
        var inbox = ns.GetDefaultFolder(OlDefaultFolders.olFolderInbox);
        MAPIFolder target = inbox;

        // Navigate using full path like \\user@domain\Inbox\SubFolder
        if (!string.IsNullOrEmpty(folderPath) && folderPath != "Inbox")
        {
            target = FindFolderByPath(inbox, folderPath);
        }

        var items = target.Items;
        items.Sort("[ReceivedTime]", true);

        var results = new List<object>();
        int idx = 0;
        foreach (var raw in items)
        {
            if (idx >= count) break;
            if (raw is MailItem mail)
            {
                results.Add(new
                {
                    id = Safe(() => mail.EntryID) ?? "",
                    subject = Safe(() => mail.Subject) ?? "(no subject)",
                    fromName = Safe(() => mail.SenderName) ?? "Unknown",
                    fromEmail = Safe(() => mail.SenderEmailAddress) ?? "",
                    receivedAt = Safe(() => mail.ReceivedTime.ToString("o")) ?? "",
                    bodyPreview = Safe(() => mail.Body != null && mail.Body.Length > 200 ? mail.Body.Substring(0, 200) : mail.Body) ?? "",
                    isRead = !SafeBool(() => mail.UnRead),
                    importance = Safe(() => mail.Importance.ToString().ToLower()) ?? "normal"
                });
                idx++;
            }
        }
        return JsonSerializer.Serialize(results, JsonOpts);
    }

    static MAPIFolder FindFolderByPath(MAPIFolder root, string targetPath)
    {
        // Path is like \\user@domain\Inbox\Sub1\Sub2
        // Extract the segments after "Inbox"
        var inboxIdx = targetPath.IndexOf("\\Inbox\\", StringComparison.OrdinalIgnoreCase);
        if (inboxIdx < 0) return root;

        var afterInbox = targetPath.Substring(inboxIdx + "\\Inbox\\".Length);
        if (string.IsNullOrEmpty(afterInbox)) return root;

        var segments = afterInbox.Split(new[] { '\\' }, StringSplitOptions.RemoveEmptyEntries);
        var current = root;

        foreach (var seg in segments)
        {
            bool found = false;
            try
            {
                foreach (MAPIFolder sub in current.Folders)
                {
                    if (string.Equals(sub.Name, seg, StringComparison.OrdinalIgnoreCase))
                    {
                        current = sub;
                        found = true;
                        break;
                    }
                }
            }
            catch { }
            if (!found) return root; // segment not found, fallback
        }
        return current;
    }

    static string GetEmailBody(NameSpace ns, string entryId)
    {
        try
        {
            var item = ns.GetItemFromID(entryId);
            if (item is MailItem mail)
            {
                return JsonSerializer.Serialize(new
                {
                    id = Safe(() => mail.EntryID) ?? "",
                    subject = Safe(() => mail.Subject) ?? "",
                    fromName = Safe(() => mail.SenderName) ?? "",
                    fromEmail = Safe(() => mail.SenderEmailAddress) ?? "",
                    receivedAt = Safe(() => mail.ReceivedTime.ToString("o")) ?? "",
                    to = Safe(() => mail.To) ?? "",
                    cc = Safe(() => mail.CC) ?? "",
                    htmlBody = Safe(() => mail.HTMLBody) ?? "",
                    body = Safe(() => mail.Body) ?? "",
                    importance = Safe(() => mail.Importance.ToString().ToLower()) ?? "normal",
                    hasAttachments = SafeBool(() => mail.Attachments.Count > 0),
                    attachmentCount = 0
                }, JsonOpts);
            }
        }
        catch (System.Exception ex)
        {
            return JsonSerializer.Serialize(new { error = ex.Message }, JsonOpts);
        }
        return JsonSerializer.Serialize(new { error = "Email not found" }, JsonOpts);
    }

    static string Safe(Func<string> fn)
    {
        try { return fn(); }
        catch { return null; }
    }

    static bool SafeBool(Func<bool> fn)
    {
        try { return fn(); }
        catch { return false; }
    }
}
