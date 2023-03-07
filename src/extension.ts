'use strict';

import * as vscode from 'vscode';
import * as k8s from 'vscode-kubernetes-tools-api';
import * as path from 'path';

const JSYAML = require('js-yaml');

interface ResourceType {
    name: string;
    shortName: string;
    api: string;
    namespaced: boolean;
    kind: string;
    autoRefresh?: boolean;
    showFilters?: boolean;
};

let extensionContextPath = '';
let explorer;
let kubectl;

class ApiResourceFieldNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    private context: string;
    private resourceType: ResourceType;
    private path: string;
    private name: string;
    private type: string;

    constructor(kubectl: k8s.KubectlV1, context: string, resourceType: ResourceType, path: string, name: string, type: string) {
        this.kubectl = kubectl;
        this.context = context;
        this.resourceType = resourceType;
        this.path = path;
        this.name = name;
        this.type = type;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`${this.name}: ${this.type}`, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = `Path: ${this.path}\nType: ${this.type}`;
        treeItem.iconPath = new vscode.ThemeIcon('file');
        treeItem.contextValue = 'field';
        return treeItem;
    }
}

class ApiResourceFieldsNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    private context: string;
    private resourceType: ResourceType;
    private path: string;
    private name: string;
    private fields: any;

    constructor(kubectl: k8s.KubectlV1, context: string, resourceType: ResourceType, path: string, name: string, fields: any) {
        this.kubectl = kubectl;
        this.context = context;
        this.resourceType = resourceType;
        this.path = path;
        this.name = name;
        this.fields = fields;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        if (this.fields) {
            const treeNodes: k8s.ClusterExplorerV1.Node[] = [];
            const keys = Object.keys(this.fields);
            keys.forEach(key => {
                const value = this.fields[key];
                const p = `${this.path}.${key}`;
                if (typeof value === 'object') {
                    treeNodes.push(
                        new ApiResourceFieldsNode(
                            this.kubectl,
                            this.context,
                            this.resourceType,
                            p,
                            key,
                            value
                        )
                    );
                } else {
                    treeNodes.push(
                        new ApiResourceFieldNode(
                            this.kubectl,
                            this.context,
                            this.resourceType,
                            p,
                            key,
                            value
                        )
                    );
                }
            });
            return treeNodes;
        }
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`${this.name}`, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.tooltip = `Path: ${this.path}`;
        treeItem.iconPath = new vscode.ThemeIcon('files');
        treeItem.contextValue = 'field';
        return treeItem;
    }
}


class ApiResourceNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    private context: string;
    private resourceType: ResourceType;

    private resourceTypeWithIcon: any = {
        clusterroles: 'c-role',
        configmaps: 'cm',
        crb: 'crb',
        customresourcedefinitions: 'crd',
        cronjobs: 'cronjob',
        deployments: 'deploy',
        daemonsets: 'ds',
        endpoints: 'ep',
        group: 'group',
        helmreleases: 'helm',
        horizontalpodautoscalers: 'hpa',
        ingresses: 'ing',
        jobs: 'job',
        limitranges: 'limits',
        networkpolicies: 'netpol',
        namespaces: 'ns',
        nodes: 'node',
        pods: 'pod',
        psp: 'psp',
        persistentvolumes: 'pv',
        persistentvolumeclaims: 'pvc',
        resourcequotas: 'quota',
        rolebindings: 'rb',
        roles: 'role',
        replicasets: 'rs',
        serviceaccounts: 'sa',
        storageclasses: 'sc',
        secrets: 'secret',
        statefulsets: 'sts',
        services: 'svc',
        user: 'user',
        volumeattachments: 'vol',
    };

    constructor(kubectl: k8s.KubectlV1, context: string, resourceType: ResourceType) {
        this.kubectl = kubectl;
        this.context = context;
        this.resourceType = resourceType;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        try {
            const fields = await ApiResourcesNodeContributor.getFieldsObject(this.kubectl, this.resourceType);
            if (fields) {
                const treeNodes: k8s.ClusterExplorerV1.Node[] = [];
                const keys = Object.keys(fields);
                keys.forEach(key => {
                    const value = fields[key];
                    const p = `${this.resourceType.name}.${key}`;
                    if (typeof value === 'object') {
                        treeNodes.push(
                            new ApiResourceFieldsNode(
                                this.kubectl,
                                this.context,
                                this.resourceType,
                                p,
                                key,
                                value
                            )
                        );
                    } else {
                        treeNodes.push(
                            new ApiResourceFieldNode(
                                this.kubectl,
                                this.context,
                                this.resourceType,
                                p,
                                key,
                                value
                            )
                        );
                    }
                });
                return treeNodes;
            }

        } catch (e) {
        }
        return [];
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`${this.resourceType.name}`, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.tooltip = `Api:         ${this.resourceType.api}\nKind:        ${this.resourceType.kind}\nShort name: ${this.resourceType.shortName}`;
        // treeItem.iconPath = new vscode.ThemeIcon(this.resourceType.namespaced ? 'layers-dot' : 'layers');
        treeItem.iconPath = this.resourceIconPath(this.resourceType);
        treeItem.contextValue = this.resourceType.namespaced ? 'namespacedapiresource' : 'apiresource';
        return treeItem;
    }

    resourceIconPath(resourceType: ResourceType): vscode.Uri | vscode.ThemeIcon {
        if (Object.keys(this.resourceTypeWithIcon).includes(resourceType.name)) {
            return vscode.Uri.file(path.join(extensionContextPath, 'icons', `${this.resourceTypeWithIcon[resourceType.name]}-128.png`));
        } else {
            return new vscode.ThemeIcon(this.resourceType.namespaced ? 'layers-dot' : 'layers');
        }
    }
}

class NamespacedResourcesNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    private context: string;

    constructor(kubectl: k8s.KubectlV1, context: string) {
        this.kubectl = kubectl;
        this.context = context;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return ApiResourcesNodeContributor.getChildren(this.kubectl, this.context, true);
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`Namespaced API Resources`, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.iconPath = new vscode.ThemeIcon('layers-dot');
        treeItem.tooltip = `Namespaced API Resources in ${this.context}`;
        treeItem.contextValue = 'namespaced-api-resources';
        return treeItem;
    }
}
class ClustersResourcesNode implements k8s.ClusterExplorerV1.Node {
    private kubectl: k8s.KubectlV1;
    private context: string;

    constructor(kubectl: k8s.KubectlV1, context: string) {
        this.kubectl = kubectl;
        this.context = context;
    }

    async getChildren(): Promise<k8s.ClusterExplorerV1.Node[]> {
        return ApiResourcesNodeContributor.getChildren(this.kubectl, this.context, false);
    }

    getTreeItem(): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(`Cluster API Resources`, vscode.TreeItemCollapsibleState.Collapsed);
        treeItem.iconPath = new vscode.ThemeIcon('layers');
        treeItem.tooltip = `Cluster API Resources in ${this.context}`;
        treeItem.contextValue = 'cluster-api-resources';
        return treeItem;
    }
}

class ApiResourcesNodeContributor {
    private kubectl: k8s.KubectlV1;

    constructor(kubectl:  k8s.KubectlV1) {
        this.kubectl = kubectl;
    }

    contributesChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): boolean {
        return parent !== undefined && parent.nodeType === 'context';
    }

    async getChildren(parent: k8s.ClusterExplorerV1.ClusterExplorerNode | undefined): Promise<k8s.ClusterExplorerV1.Node[]> {
        if (parent) {
            return [

                new NamespacedResourcesNode(this.kubectl, (parent as k8s.ClusterExplorerV1.ClusterExplorerContextNode).name),
                new ClustersResourcesNode(this.kubectl, (parent as k8s.ClusterExplorerV1.ClusterExplorerContextNode).name)
                // new ApiResourcesNode(this.kubectl, (parent as k8s.ClusterExplorerV1.ClusterExplorerContextNode).name)
            ];
        }
        return [];
    }

    static async getFieldsObject(kubectl: k8s.KubectlV1, resourceType: ResourceType) {
        const explainCommand = `explain ${resourceType.name} --api-version=${resourceType.api} --recursive=true`;
        const explainResourceTypeResult = await kubectl?.invokeCommand(explainCommand);
        if (explainResourceTypeResult&& explainResourceTypeResult.code === 0) {
            const explainOutputArray = explainResourceTypeResult.stdout.split(/\r?\n/g);
            const explainOutput = explainOutputArray.join('\n');
            let descriptionLines: Array<string> = [];

            let explainOutputLine = explainOutputArray.shift();
            while (explainOutputLine !== undefined) {
                // Skip till DESCRIPTION: line
                if (explainOutputLine.trim() === 'DESCRIPTION:') {
                break;
                }
                explainOutputLine = explainOutputArray.shift();
            }
            explainOutputLine = explainOutputArray.shift();
            while (explainOutputLine !== undefined) {
                // Skip till FIELDS: line, record  description
                if (explainOutputLine.trim() === 'FIELDS:') {
                break;
                }
                descriptionLines.push(explainOutputLine);
                explainOutputLine = explainOutputArray.shift();
            }

            const description = descriptionLines.join('\n');

            let fieldsText = explainOutputArray.join('\n');

            fieldsText = fieldsText.replace(/   /g, '  ');
            fieldsText = fieldsText.replace(/([a-zA-Z0-9]+)\t(\S+)/g, '$1: "$2"');
            fieldsText = `${resourceType.name}: "<Object>"\n` + fieldsText;
            fieldsText = fieldsText.replace(/:\s+"<Object>"/g, ':');
            fieldsText = fieldsText.replace(/:\s+"<\[\]Object>"/g, ':');

            return JSYAML.load(fieldsText, {})[resourceType.name];
        }

        return {};
    }


    static async getChildren(kubectl: k8s.KubectlV1, context: string, namespaced: boolean): Promise<k8s.ClusterExplorerV1.Node[]> {
        const apiResourcesShellResult = await kubectl.invokeCommand('api-resources');
        if (apiResourcesShellResult) {
            if (apiResourcesShellResult.stdout && apiResourcesShellResult.stdout.length > 0) {
                const apiResourcesRaw = apiResourcesShellResult.stdout.replace(/true /g, 'true ').replace(/false/g, 'false').split('\n');
                const apiResourcesHeaderRaw = `${apiResourcesRaw.shift()}                               `;

                const columns = apiResourcesHeaderRaw?.match(/^(NAME\s+)(SHORTNAMES\s+)(APIVERSION\s+|APIGROUP\s+)(NAMESPACED\s+)(KIND\s+)$/);
                columns?.shift();

                const columnRanges: number[][] = [];
                let from = 0;
                let to = 0;
                columns?.forEach((column) => {
                    to += column.length;
                    columnRanges.push([from, to]);
                    from = to;
                });

                const apiResources: string[] = [];
                const paddings: number[] = [];
                columnRanges.forEach(columnRange => {
                    paddings.push(columnRange[1] - columnRange[0]);
                });
                apiResourcesRaw.forEach((apiResource) => {
                    const apiResourcesCols: string[] = [];
                    columnRanges.forEach(columnRange => {
                        apiResourcesCols.push(apiResource.substring(columnRange[0], columnRange[1]).trim());
                    });
                    apiResources.push(
                        `${apiResourcesCols[0].padEnd(paddings[0])}${apiResourcesCols[1].padEnd(paddings[1])}${apiResourcesCols[2].padEnd(paddings[2])}${apiResourcesCols[3].padStart(paddings[3])}${apiResourcesCols[4]}`
                    );
                });

                apiResources.pop();
                apiResources.sort();

                let resourceTypesToSend: k8s.ClusterExplorerV1.Node[] = [];
                apiResources.forEach((apiResourceLine) => {
                    const apiResourcesCols: string[] = [];
                    columnRanges.forEach(columnRange => {
                        const col = apiResourceLine.substring(columnRange[0], columnRange[1]).trim();
                        apiResourcesCols.push(col);
                    });

                    const resourceType = {
                        name: apiResourcesCols[0],
                        shortName: apiResourcesCols[1],
                        api: apiResourcesCols[2],
                        namespaced: (apiResourcesCols[3] === 'true' ? true : false),
                        kind: apiResourcesCols[4],
                    };

                    const resourceTypeNode = new ApiResourceNode(kubectl,
                        context,
                        resourceType
                    );

                    if (resourceType.namespaced === namespaced) {
                        resourceTypesToSend.push(resourceTypeNode);
                    }
                });

                return resourceTypesToSend;
            }
        }
        return [];
    }
}

export async function activate(context: vscode.ExtensionContext) {
    extensionContextPath = context.extensionPath;
    explorer = await k8s.extension.clusterExplorer.v1;
    if (!explorer.available) {
        vscode.window.showErrorMessage(`ClusterExplorer not available.`);
        return;
    }
    kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return;
    }

    explorer.api.registerNodeContributor(new ApiResourcesNodeContributor(kubectl.api));

    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.explain', explainApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.explain-field', explainApiResourceField));

    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.describe-all', describeAllApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.namespaced-api-resource-node.describe-all-all-namespaces', describeAllAllNamespacesApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.describe-selected', describeSelectedApiResource));

    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.get-all', getAllApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.namespaced-api-resource-node.get-all-all-namespaces', getAllAllNamespacesApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.get-selected', getSelectedApiResource));

    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.load-all', loadAllApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.namespaced-api-resource-node.load-all-all-namespaces', loadAllAllNamespacesApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.load-selected', loadSelectedApiResource));

    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.watch-all', watchAllApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.namespaced-api-resource-node.watch-all-all-namespaces', watchAllAllNamespacesApiResource));
    context.subscriptions.push(vscode.commands.registerCommand('k8s.api-resource-node.watch-selected', watchSelectedApiResource));

    context.subscriptions.push(vscode.commands.registerCommand('vscode-kubernetes-api-resources.show-kubernetes-commander', showKubernetesCommander));
}

async function describeAllApiResource(target?: any) {
    commandImpl(target, 'describe');
}
async function describeAllAllNamespacesApiResource(target?: any) {
    commandAllNamespaces(target, 'describe');
}

async function describeSelectedApiResource(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            const selectedResourceTypeItems = await chooseApiResource(target.impl.resourceType);
            if (selectedResourceTypeItems && (await selectedResourceTypeItems).length > 0) {
                commandImpl(target, 'describe', selectedResourceTypeItems.join(' '));
            }
        }
    }
}

async function getAllApiResource(target?: any) {
    commandImpl(target, 'get', '-o wide');
}
async function getAllAllNamespacesApiResource(target?: any) {
    commandAllNamespaces(target, 'get', '-o wide');
}

async function getSelectedApiResource(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            const selectedResourceTypeItems = await chooseApiResource(target.impl.resourceType);
            if (selectedResourceTypeItems && (await selectedResourceTypeItems).length > 0) {
                commandImpl(target, 'get', `-o wide ${selectedResourceTypeItems.join(' ')}`);
            }
        }
    }
}

async function loadAllApiResource(target?: any) {
    commandImpl(target, 'get', '-o yaml');
}

async function loadAllAllNamespacesApiResource(target?: any) {
    commandAllNamespaces(target, 'get', '-o yaml');
}

async function loadSelectedApiResource(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            const selectedResourceTypeItems = await chooseApiResource(target.impl.resourceType);
            if (selectedResourceTypeItems && (await selectedResourceTypeItems).length > 0) {
                commandImpl(target, 'get', `-o yaml ${selectedResourceTypeItems.join(' ')}`);
            }
        }
    }
}

async function watchAllApiResource(target?: any) {
    commandImpl(target, 'get', '-o wide', false, true);
}

async function watchAllAllNamespacesApiResource(target?: any) {
    commandAllNamespaces(target, 'get', '-o wide', true);
}

async function watchSelectedApiResource(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            const selectedResourceTypeItems = await chooseApiResource(target.impl.resourceType);
            if (selectedResourceTypeItems && (await selectedResourceTypeItems).length > 0) {
                commandImpl(target, 'get', `-o wide ${selectedResourceTypeItems.join(' ')}`);
            }
        }
    }
}

async function chooseApiResource(resourceType: ResourceType): Promise<string[]> {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return [];
    }
    const resourceTypeCommand = `get ${resourceType.shortName} --no-headers -o custom-columns=":metadata.name"`;
    const resourceTypeResult = await kubectl.api.invokeCommand(resourceTypeCommand);
    if (resourceTypeResult && resourceTypeResult.code === 0) {
        const allResourceTypeItems = resourceTypeResult.stdout.split(/\r?\n/g);
        allResourceTypeItems.pop();
        const selectedResourceTypeItems =  await vscode.window.showQuickPick(allResourceTypeItems, {
            canPickMany: true,
            title: `Select ${resourceType.name}s to load`
        });
        if (selectedResourceTypeItems) {
            return selectedResourceTypeItems;
        }
    }
    return [];
}

async function commandAllNamespaces(target?: any, command?: string, args = '', watch = false) {
    commandImpl(target, command, args, true, watch);
}

async function commandImpl(target?: any, command?: string, args = '', allNamespaces = false, watch = false) {
    if (command && target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            const kubectl = await k8s.extension.kubectl.v1;
            if (!kubectl.available) {
                vscode.window.showErrorMessage(`kubectl not available.`);
                return;
            }
            const resourceTypeCommand = `${command} ${target.impl.resourceType.shortName} ${args || ''} ${allNamespaces ? '-A' : ''} ${watch ? '-w' : ''}`;
            if (watch) {
                const commentPrefix = (process.platform === 'win32' ? 'REM' : '#');
                const terminal = vscode.window.createTerminal(
                {
                    name: `${resourceTypeCommand}`,
                    location: vscode.TerminalLocation.Editor,
                    iconPath: new vscode.ThemeIcon('$(eye')
                });
                terminal.show();
                terminal.sendText(`kubectl ${resourceTypeCommand}\n`);
            } else {
                const resourceTypeResult = await kubectl.api.invokeCommand(resourceTypeCommand);
                if (resourceTypeResult && resourceTypeResult.code === 0) {
                    const resourceTypeCommandOutput = resourceTypeResult.stdout.split(/\r?\n/g).join('\n');
                    // Open the document
                    let resourceTypeCommandOutputDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                        language: '-o yaml' === args ? 'yaml' : 'plaintext',
                        content: `# kubectl ${resourceTypeCommand}\n\n${resourceTypeCommandOutput}`
                    });
                    await vscode.window.showTextDocument(resourceTypeCommandOutputDocument);
                }
            }
        }
    }
}

async function explainApiResource(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceNode) {
            explainImpl(target.impl.resourceType, target.impl.resourceType.name);
        }
    }
}

async function explainApiResourceField(target?: any) {
    if (target && target.nodeType === 'extension') {
        if (target.impl instanceof ApiResourceFieldsNode || target.impl instanceof ApiResourceFieldNode) {
            explainImpl(target.impl.resourceType, target.impl.path);
        }
    }
}

async function explainImpl(resourceType: ResourceType, path: string) {
    const kubectl = await k8s.extension.kubectl.v1;
    if (!kubectl.available) {
        vscode.window.showErrorMessage(`kubectl not available.`);
        return;
    }
    const explainResourceTypeCommand = `explain --api-version=${resourceType.api} --recursive=false ${path}`;
    const explainResourceTypeResult = await kubectl.api.invokeCommand(explainResourceTypeCommand);
    if (explainResourceTypeResult) {
        if (explainResourceTypeResult.code === 0) {
            const explainOutput = explainResourceTypeResult.stdout.split(/\r?\n/g).join('\n');
            // Open the document
            let explainOutputDocument: vscode.TextDocument = await vscode.workspace.openTextDocument({
                language: 'plaintext',
                content: `# kubectl ${explainResourceTypeCommand}\n\n${explainOutput}`
            });
            await vscode.window.showTextDocument(explainOutputDocument);
        }
    }
}

async function showKubernetesCommander() {
    if (vscode.extensions.getExtension('sandipchitale.vscode-kubernetes-commander-editor')) {
        vscode.commands.executeCommand('vscode-kubernetes-commander-editor.show-kubernetes-commander');
    } else {
        const answer = await vscode.window.showInformationMessage(
            'Extension Kubernetes Commander (in editor) is not installed. Do you want to install it?', 'Yes', 'No');
        if (answer === 'Yes') {
            vscode.commands.executeCommand('workbench.extensions.installExtension', 'sandipchitale.vscode-kubernetes-commander-editor');
        }
    }
}

export function deactivate() {}
