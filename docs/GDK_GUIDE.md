# What GitLab GDK is and how to use it

**GDK means GitLab Development Kit.** It runs a development copy of GitLab and its supporting services. GitLab is an application for storing code, managing projects, issues, and collaboration. GDK's main purpose is helping developers work on GitLab itself. Your existing local installation can also serve as a realistic application to observe with accounts and disposable data you control. It is not a scanner or an intentionally vulnerable training application. [GitLab's GDK introduction](https://docs.gitlab.com/development/contributing/first_contribution/configure-dev-env-gdk/).

You do not need GDK to start the SurfaceTrace course. Begin with the smaller included lab. GDK is introduced in lesson 21.

## How the tools fit together

| Tool | Its job |
| --- | --- |
| GitLab GDK | Runs the application you can later study |
| Browser DevTools | Shows requests, responses, page structure, and browser storage |
| Burp Suite | Records browser traffic and lets you manually resend a chosen request |
| SurfaceTrace | Imports a recording and organizes observations, questions, comparisons, and evidence |

GDK and SurfaceTrace are standalone programs. Neither is installed inside the other. To use them together, browse GitLab with DevTools or Burp, record a small normal workflow, review a sanitized HAR, and import that recording into SurfaceTrace. There is no automatic live Burp/GDK connection. A new import replaces active import context, so preserve previous captures and important notes first. The current SurfaceTrace UI has no project picker.

## Your workstation

- Actual installation: `/home/superadmin/gdk` inside the **Ubuntu** WSL distribution.
- Windows folder `C:\Users\SuperAdmin\.vscode\GDK`: your notes, not a second installation.
- GitLab: http://127.0.0.1:3000/users/sign_in
- SurfaceTrace: http://127.0.0.1:5173
- Small SurfaceTrace practice page: http://127.0.0.1:5173/lab/projects/100

In an **Ubuntu terminal**, start GitLab:

```bash
cd ~/gdk
bin/gdk start
bin/gdk status
```

Allow time for startup, then open the GitLab sign-in URL in your Windows browser. A status table can show stale service records after a shutdown; verify the actual page too. Use your configured local password. Do not rely on an old default password from a command sheet.

Stop GitLab only:

```bash
cd ~/gdk
bin/gdk stop
```

This native Ubuntu GDK does not require the SurfaceTrace Docker container. Starting Docker does not start GDK; stopping GDK does not stop SurfaceTrace. `wsl --shutdown` is a broad shutdown of WSL distributions and can disrupt both GDK and Docker Desktop. It is not the routine stop command for either application.

## A useful first GitLab exercise

1. Start GitLab and sign in with your local account. Use an administrator only for setup.
2. Choose or create a disposable project with invented data. Confirm visibility and membership in the UI. Usernames such as `guest-tester` do not prove their current roles.
3. Open DevTools Network before opening a normal project page. Identify one request and its response.
4. Write the method, path, response status, and the normal action that caused it. Keep credential values out of notes.
5. Export only the relevant traffic as a sanitized HAR and review it locally. Sanitization does not guarantee removal of private response bodies.
6. Import the recording into SurfaceTrace after preserving earlier work. Explain one observation and one question without changing GitLab settings.

For an access-control exercise later, establish project visibility, real test-account memberships, and expected behavior first. Separate browser profiles help keep identities distinct. Leave outbound-network protections enabled. A webhook being blocked by policy is not a broken setup.

## Network detail that matters

Windows, Ubuntu, and Docker have different networking contexts. From inside the SurfaceTrace container, `127.0.0.1:3000` means the container itself, not necessarily Ubuntu's GitLab. Use the passive HAR workflow first. Direct active replay would need separately verified connectivity and scope configuration; this guide does not set that up.

## Inspection findings

The checkout origins match the official GDK repository and GitLab's documented community development checkout. Starting GDK and checking the Windows sign-in URL returned HTTP 200 with a GitLab page. This verifies startup and page reachability, not every application feature or account role.

`bin/gdk doctor` reported an older GDK checkout, an outdated mise version, Git maintenance advice, and roughly 2.1 GB of GitLab logs. Two untracked Redis temporary dump files were present. These are maintenance items to review separately; no update, database reset, log deletion, account change, or network-policy change was made for this classroom work. Existing account roles and the `root/test` project were not verified through an authenticated session.
