Release @apollo/PACKAGE1@X.Y.Z [, @apollo/PACKAGE2@X.Y.Z]

As with [release PRs in the past](https://github.com/apollographql/federation/issues?q=label%3A%22:label:%20release%22+is%3Aclosed), this is a PR tracking a `release-x.y.z` branch for an upcoming release. 🙌   The version in the title of this PR should correspond to the appropriate branch.

The intention of these release branches is to gather changes which are intended to land in a specific version (again, indicated by the subject of this PR).  Release branches allow additional clarity into what is being staged, provide a forum for comments from the community pertaining to the release's stability, and to facilitate the creation of pre-releases (e.g. `alpha`, `beta`, `rc`) without affecting the `main` branch.

PRs for new features might be opened against or re-targeted to this branch by the project maintainers.  The `main` branch may be periodically merged into this branch up until the point in time that this branch is being prepared for release.  Depending on the size of the release, this may be once it reaches RC (release candidate) stage with an `-rc.x` release suffix.  Some less substantial releases may be short-lived and may never have pre-release versions.

When this version is officially released onto the `latest` npm tag, this PR will be merged into `main`.
