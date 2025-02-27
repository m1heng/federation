import {
  ArgumentNode,
  ASTNode,
  buildASTSchema as buildGraphqlSchemaFromAST,
  DirectiveLocation,
  DirectiveLocationEnum,
  DirectiveNode,
  DocumentNode,
  GraphQLError,
  GraphQLSchema,
  Kind,
  ListTypeNode,
  NamedTypeNode,
  parse,
  printError,
  TypeNode,
  VariableDefinitionNode,
  VariableNode
} from "graphql";
import { CoreDirectiveArgs, CoreSpecDefinition, CORE_VERSIONS, FeatureUrl, isCoreSpecDirectiveApplication, removeFeatureElements } from "./coreSpec";
import { arrayEquals, assert, mapValues, MapWithCachedArrays, setValues } from "./utils";
import { withDefaultValues, valueEquals, valueToString, valueToAST, variablesInValue, valueFromAST } from "./values";
import { removeInaccessibleElements } from "./inaccessibleSpec";
import { printSchema, Options, defaultPrintOptions } from './print';
import { sameType } from './types';
import { addIntrospectionFields, introspectionFieldNames, isIntrospectionName } from "./introspection";
import { err } from '@apollo/core-schema';
import { GraphQLErrorExt } from "@apollo/core-schema/dist/error";
import { validateSDL } from "graphql/validation/validate";
import { SDLValidationRule } from "graphql/validation/ValidationContext";
import { specifiedSDLRules } from "graphql/validation/specifiedRules";
import { validateSchema } from "./validate";

const validationErrorCode = 'GraphQLValidationFailed';

export const ErrGraphQLValidationFailed = (causes: GraphQLError[]) =>
  err(validationErrorCode, {
    message: 'The schema is not a valid GraphQL schema',
    causes
  });

/**
 * Given an error that may have been thrown during schema validation, extract the causes of validation failure.
 * If the error is not a graphQL error, undefined is returned.
 */
export function errorCauses(e: Error): GraphQLError[] | undefined {
  if (e instanceof GraphQLErrorExt) {
    if (e.code === validationErrorCode) {
      return ((e as any).causes) as GraphQLError[];
    }
    return [e];
  }
  if (e instanceof GraphQLError) {
    return [e];
  }
  return undefined;
}

export function printGraphQLErrorsOrRethrow(e: Error): string {
  const causes = errorCauses(e);
  if (!causes) {
    throw e;
  }
  return causes.map(e => printError(e)).join('\n\n');
}

export function printErrors(errors: GraphQLError[]): string {
  return errors.map(e => printError(e)).join('\n\n');
}

export const typenameFieldName = '__typename';

export type QueryRootKind = 'query';
export type MutationRootKind = 'mutation';
export type SubscriptionRootKind = 'subscription';
export type SchemaRootKind = QueryRootKind | MutationRootKind | SubscriptionRootKind;

export const allSchemaRootKinds: SchemaRootKind[] = ['query', 'mutation', 'subscription'];

export function defaultRootName(rootKind: SchemaRootKind): string {
  return rootKind.charAt(0).toUpperCase() + rootKind.slice(1);
}

function checkDefaultSchemaRoot(type: NamedType): SchemaRootKind | undefined {
  if (type.kind !== 'ObjectType') {
    return undefined;
  }
  switch (type.name) {
    case 'Query': return 'query';
    case 'Mutation': return 'mutation';
    case 'Subscription': return 'subscription';
    default: return undefined;
  }
}

export type Type = NamedType | WrapperType;
export type NamedType = ScalarType | ObjectType | InterfaceType | UnionType | EnumType | InputObjectType;
export type OutputType = ScalarType | ObjectType | InterfaceType | UnionType | EnumType | ListType<any> | NonNullType<any>;
export type InputType = ScalarType | EnumType | InputObjectType | ListType<any> | NonNullType<any>;
export type WrapperType = ListType<any> | NonNullType<any>;
export type AbstractType = InterfaceType | UnionType;
export type CompositeType = ObjectType | InterfaceType | UnionType;

export type OutputTypeReferencer = FieldDefinition<any>;
export type InputTypeReferencer = InputFieldDefinition | ArgumentDefinition<any>;
export type ObjectTypeReferencer = OutputTypeReferencer | UnionType | SchemaDefinition;
export type InterfaceTypeReferencer = OutputTypeReferencer | ObjectType | InterfaceType;

export type NullableType = NamedType | ListType<any>;

export type NamedTypeKind = NamedType['kind'];

export function isNamedType(type: Type): type is NamedType {
  return type instanceof BaseNamedType;
}

export function isWrapperType(type: Type): type is WrapperType {
  return isListType(type) || isNonNullType(type);
}

export function isListType(type: Type): type is ListType<any> {
  return type.kind == 'ListType';
}

export function isNonNullType(type: Type): type is NonNullType<any> {
  return type.kind == 'NonNullType';
}

export function isScalarType(type: Type): type is ScalarType {
  return type.kind == 'ScalarType';
}

export function isCustomScalarType(type: Type): boolean {
  return isScalarType(type) && !graphQLBuiltIns.defaultGraphQLBuiltInTypes.includes(type.name);
}

export function isIntType(type: Type): boolean {
  return type === type.schema().intType();
}

export function isStringType(type: Type): boolean {
  return type === type.schema().stringType();
}

export function isFloatType(type: Type): boolean {
  return type === type.schema().floatType();
}

export function isBooleanType(type: Type): boolean {
  return type === type.schema().booleanType();
}

export function isIDType(type: Type): boolean {
  return type === type.schema().idType();
}

export function isObjectType(type: Type): type is ObjectType {
  return type.kind == 'ObjectType';
}

export function isInterfaceType(type: Type): type is InterfaceType {
  return type.kind == 'InterfaceType';
}

export function isEnumType(type: Type): type is EnumType {
  return type.kind == 'EnumType';
}

export function isUnionType(type: Type): type is UnionType {
  return type.kind == 'UnionType';
}

export function isInputObjectType(type: Type): type is InputObjectType {
  return type.kind == 'InputObjectType';
}

export function isOutputType(type: Type): type is OutputType {
  switch (baseType(type).kind) {
    case 'ScalarType':
    case 'ObjectType':
    case 'UnionType':
    case 'EnumType':
    case 'InterfaceType':
      return true;
    default:
      return false;
  }
}

export function isInputType(type: Type): type is InputType {
  switch (baseType(type).kind) {
    case 'ScalarType':
    case 'EnumType':
    case 'InputObjectType':
      return true;
    default:
      return false;
  }
}

export function baseType(type: Type): NamedType {
  return isWrapperType(type) ? type.baseType() : type;
}

export function isNullableType(type: Type): boolean {
  return !isNonNullType(type);
}

export function isAbstractType(type: Type): type is AbstractType {
  return isInterfaceType(type) || isUnionType(type);
}

export function isCompositeType(type: Type): type is CompositeType {
  return isObjectType(type) || isInterfaceType(type) || isUnionType(type);
}

export function possibleRuntimeTypes(type: CompositeType): readonly ObjectType[] {
  switch (type.kind) {
    case 'InterfaceType': return type.possibleRuntimeTypes();
    case 'UnionType': return type.types();
    case 'ObjectType': return [type];
  }
}

export function runtimeTypesIntersects(t1: CompositeType, t2: CompositeType): boolean {
  const rt1 = possibleRuntimeTypes(t1);
  const rt2 = possibleRuntimeTypes(t2);
  for (const obj1 of rt1) {
    if (rt2.some(obj2 => obj1.name === obj2.name)) {
      return true;
    }
  }
  return false;
}

export const executableDirectiveLocations: DirectiveLocationEnum[] = [
  'QUERY',
  'MUTATION',
  'SUBSCRIPTION',
  'FIELD',
  'FRAGMENT_DEFINITION',
  'FRAGMENT_SPREAD',
  'INLINE_FRAGMENT',
  'VARIABLE_DEFINITION',
];

/**
 * Converts a type to an AST of a "reference" to that type, one corresponding to the type `toString()` (and thus never a type definition).
 *
 * To print a type definition, see the `printTypeDefinitionAndExtensions` method.
 */
export function typeToAST(type: Type): TypeNode {
  switch (type.kind) {
    case 'ListType':
      return {
        kind: 'ListType',
        type: typeToAST(type.ofType)
      };
    case 'NonNullType':
      return {
        kind: 'NonNullType',
        type: typeToAST(type.ofType) as NamedTypeNode | ListTypeNode
      };
    default:
      return {
        kind: 'NamedType',
        name: { kind: 'Name', value: type.name }
      };
  }
}

export function typeFromAST(schema: Schema, node: TypeNode): Type {
  switch (node.kind) {
    case 'ListType':
      return new ListType(typeFromAST(schema, node.type));
    case 'NonNullType':
      return new NonNullType(typeFromAST(schema, node.type) as NullableType);
    default:
      const type = schema.type(node.name.value);
      if (!type) {
        throw new GraphQLError(`Unknown type "${node.name.value}"`, node);
      }
      return type;
  }
}

export type LeafType = ScalarType | EnumType;

export function isLeafType(type: Type): type is LeafType {
  return isScalarType(type) || isEnumType(type);
}

export interface Named {
  readonly name: string;
}

export type ExtendableElement = SchemaDefinition | NamedType;

export class DirectiveTargetElement<T extends DirectiveTargetElement<T>> {
  public readonly appliedDirectives: Directive<T>[] = [];

  constructor(private readonly _schema: Schema) {}

  schema(): Schema {
    return this._schema;
  }

  appliedDirectivesOf(name: string): Directive<T>[];
  appliedDirectivesOf<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}>(definition: DirectiveDefinition<TApplicationArgs>): Directive<T, TApplicationArgs>[];
  appliedDirectivesOf(nameOrDefinition: string | DirectiveDefinition): Directive<T>[] {
    const directiveName = typeof nameOrDefinition === 'string' ? nameOrDefinition : nameOrDefinition.name;
    return this.appliedDirectives.filter(d => d.name == directiveName);
  }

  hasAppliedDirective(nameOrDefinition: string | DirectiveDefinition): boolean {
    const directiveName = typeof nameOrDefinition === 'string' ? nameOrDefinition : nameOrDefinition.name;
    return this.appliedDirectives.some(d => d.name == directiveName);
  }

  applyDirective<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}>(
    defOrDirective: Directive<T, TApplicationArgs> | DirectiveDefinition<TApplicationArgs>,
    args?: TApplicationArgs
  ): Directive<T, TApplicationArgs> {
    let toAdd: Directive<T, TApplicationArgs>;
    if (defOrDirective instanceof Directive) {
      if (defOrDirective.schema() != this.schema()) {
        throw new Error(`Cannot add directive ${defOrDirective} to ${this} as it is attached to another schema`);
      }
      toAdd = defOrDirective;
      if (args) {
        toAdd.setArguments(args);
      }
    } else {
      toAdd = new Directive<T, TApplicationArgs>(defOrDirective.name, args ?? Object.create(null));
    }
    Element.prototype['setParent'].call(toAdd, this);
    // TODO: we should typecheck arguments or our TApplicationArgs business is just a lie.
    this.appliedDirectives.push(toAdd);
    return toAdd;
  }

  appliedDirectivesToDirectiveNodes() : DirectiveNode[] | undefined {
    if (this.appliedDirectives.length == 0) {
      return undefined;
    }

    return this.appliedDirectives.map(directive => {
      return {
        kind: 'Directive',
        name: {
          kind: Kind.NAME,
          value: directive.name,
        },
        arguments: directive.argumentsToAST()
      };
    });
  }

  appliedDirectivesToString(): string {
    return this.appliedDirectives.length == 0
      ? ''
      : ' ' + this.appliedDirectives.join(' ');
  }

  variablesInAppliedDirectives(): Variables {
    return this.appliedDirectives.reduce((acc: Variables, d) => mergeVariables(acc, variablesInArguments(d.arguments())), []);
  }
}

export function sourceASTs(...elts: ({ sourceAST?: ASTNode } | undefined)[]): ASTNode[] {
  return elts.map(elt => elt?.sourceAST).filter(elt => elt !== undefined) as ASTNode[];
}

// Not exposed: mostly about avoid code duplication between SchemaElement and Directive (which is not a SchemaElement as it can't
// have applied directives or a description
abstract class Element<TParent extends SchemaElement<any, any> | Schema | DirectiveTargetElement<any>> {
  protected _parent?: TParent;
  sourceAST?: ASTNode;

  schema(): Schema {
    const schema = this.schemaInternal();
    assert(schema, 'requested schema does not exist. Probably because the element is unattached');
    return schema;
  }

  // this function exists because sometimes we can have an element that will be attached soon even though the current state is unattached
  // (mainly for callbacks). Sometimes these intermediate states need to get the schema if it exists, but it may not.
  // all external clients should use schema()
  protected schemaInternal(): Schema | undefined {
    if (!this._parent) {
      return undefined;
    } else if (this._parent instanceof Schema) {
      // Note: at the time of this writing, it seems like typescript type-checking breaks a bit around generics.
      // At this point of the code, `this._parent` is typed as 'TParent & Schema', but for some reason this is
      // "not assignable to type 'Schema | undefined'" (which sounds wrong: if my type theory is not too broken,
      // 'A & B' should always be assignable to both 'A' and 'B').
      return this._parent as any;
    } else if (this._parent instanceof SchemaElement) {
      return this._parent.schemaInternal();
    } else if (this._parent instanceof DirectiveTargetElement) {
      return this._parent.schema();
    }
    assert(false, 'unreachable code. parent is of unknown type');
  }

  get parent(): TParent {
    assert(this._parent, 'trying to access non-existent parent');
    return this._parent;
  }

  isAttached(): boolean {
    return !!this._parent;
  }

  // Accessed only through Element.prototype['setParent'] (so we don't mark it protected as an override wouldn't be properly called).
  private setParent(parent: TParent) {
    assert(!this._parent, "Cannot set parent of an already attached element");
    this._parent = parent;
    this.onAttached();
  }

  protected onAttached() {
    // Nothing by default, but can be overriden.
  }

  protected checkUpdate() {
    // Allowing to add element to a detached element would get hairy. Because that would mean that when you do attach an element,
    // you have to recurse within that element to all children elements to check whether they are attached or not and to which
    // schema. And if they aren't attached, attaching them as side-effect could be surprising (think that adding a single field
    // to a schema could bring a whole hierarchy of types and directives for instance). If they are attached, it only work if
    // it's to the same schema, but you have to check.
    // Overall, it's simpler to force attaching elements before you add other elements to them.
    if (!this.isAttached()) {
      throw error(`Cannot modify detached element ${this}`);
    }
  }
}

export class Extension<TElement extends ExtendableElement> {
  protected _extendedElement?: TElement;
  sourceAST?: ASTNode;

  get extendedElement(): TElement | undefined {
    return this._extendedElement;
  }

  private setExtendedElement(element: TElement) {
    assert(!this._extendedElement, "Cannot attached already attached extension");
    this._extendedElement = element;
  }
}

// TODO: ideally, we should hide the ctor of this class as we rely in places on the fact the no-one external defines new implementations.
export abstract class SchemaElement<TOwnType extends SchemaElement<any, TParent>, TParent extends SchemaElement<any, any> | Schema> extends Element<TParent> {
  protected readonly _appliedDirectives: Directive<TOwnType>[] = [];
  description?: string;

  get appliedDirectives(): readonly Directive<TOwnType>[] {
    return this._appliedDirectives;
  }

  appliedDirectivesOf<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}>(nameOrDefinition: string | DirectiveDefinition<TApplicationArgs>): Directive<TOwnType, TApplicationArgs>[] {
    const directiveName = typeof nameOrDefinition === 'string' ? nameOrDefinition : nameOrDefinition.name;
    return this._appliedDirectives.filter(d => d.name == directiveName) as Directive<TOwnType, TApplicationArgs>[];
  }

  hasAppliedDirective(nameOrDefinition: string | DirectiveDefinition<any>): boolean {
    // From the type-system point of view, there is no `appliedDirectivesOf(_: string | DirectiveDefinition)` function, but rather 2 overloads, neither of
    // which can take 'string | DirectiveDefinition', hence the need for this surprisingly looking code. And we don't really want to remove the overloading
    // on `appliedDirectivesOf` because that would lose us the type-checking of arguments in the case where we pass a definition (or rather, we could
    // preserve it, but it would make is a bit too easy to mess up calls with the 'string' argument).
    return (typeof nameOrDefinition === 'string'
      ? this.appliedDirectivesOf(nameOrDefinition)
      : this.appliedDirectivesOf(nameOrDefinition)
    ).length !== 0;
  }

  applyDirective<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}>(
    nameOrDefOrDirective: Directive<TOwnType, TApplicationArgs> | DirectiveDefinition<TApplicationArgs> | string,
    args?: TApplicationArgs
  ): Directive<TOwnType, TApplicationArgs> {
    let toAdd: Directive<TOwnType, TApplicationArgs>;
    if (nameOrDefOrDirective instanceof Directive) {
      this.checkUpdate(nameOrDefOrDirective);
      toAdd = nameOrDefOrDirective;
      if (args) {
        toAdd.setArguments(args);
      }
    } else {
      let name: string;
      if (typeof nameOrDefOrDirective === 'string') {
        this.checkUpdate();
        const def = this.schema().directive(nameOrDefOrDirective);
        if (!def) {
          throw new GraphQLError(`Cannot apply unknown directive "@${nameOrDefOrDirective}"`);
        }
        name = nameOrDefOrDirective;
      } else {
        this.checkUpdate(nameOrDefOrDirective);
        name = nameOrDefOrDirective.name;
      }
      toAdd = new Directive<TOwnType, TApplicationArgs>(name, args ?? Object.create(null));
      Element.prototype['setParent'].call(toAdd, this);
    }
    // TODO: we should typecheck arguments or our TApplicationArgs business is just a lie.
    this._appliedDirectives.push(toAdd);
    DirectiveDefinition.prototype['addReferencer'].call(toAdd.definition!, toAdd);
    this.onModification();
    return toAdd;
  }

  protected removeAppliedDirectives() {
    // We copy the array because this._appliedDirectives is modified in-place by `directive.remove()`
    const applied = this._appliedDirectives.concat();
    applied.forEach(d => d.remove());
  }

  protected onModification() {
    const schema = this.schemaInternal();
    if (schema) {
      Schema.prototype['onModification'].call(schema);
    }
  }

  protected isElementBuiltIn(): boolean {
    return false;
  }

  protected removeTypeReferenceInternal(type: BaseNamedType<any, any>) {
    // This method is a bit of a hack: we don't want to expose it and we call it from an other class, so we call it though
    // `SchemaElement.prototype`, but we also want this to abstract as it can only be implemented by each concrete subclass.
    // As we can't have both at the same time, this method just delegate to `remoteTypeReference` which is genuinely
    // abstract. This also allow to work around the typing issue that the type checker cannot tell that every BaseNamedType
    // is a NamedType (because in theory, someone could extend BaseNamedType without listing it in NamedType; but as
    // BaseNamedType is not exported and we don't plan to make that mistake ...).
    this.removeTypeReference(type as any);
  }

  protected abstract removeTypeReference(type: NamedType): void;

  protected checkRemoval() {
    if (this.isElementBuiltIn() && !Schema.prototype['canModifyBuiltIn'].call(this.schema())) {
      throw error(`Cannot modify built-in ${this}`);
    }
    // We allow removals even on detached element because that doesn't particularly create issues (and we happen to do such
    // removals on detached internally; though of course we could refactor the code if we wanted).
  }

  protected checkUpdate(addedElement?: { schema(): Schema, isAttached(): boolean }) {
    super.checkUpdate();
    if (!Schema.prototype['canModifyBuiltIn'].call(this.schema())) {
      // Ensure this element (the modified one), is not a built-in, or part of one.
      let thisElement: SchemaElement<TOwnType, any> | Schema | undefined = this;
      while (thisElement && thisElement instanceof SchemaElement) {
        if (thisElement.isElementBuiltIn()) {
          throw error(`Cannot modify built-in (or part of built-in) ${this}`);
        }
        thisElement = thisElement.parent;
      }
    }
    if (addedElement && addedElement.isAttached()) {
      const thatSchema = addedElement.schema();
      if (thatSchema && thatSchema != this.schema()) {
        throw error(`Cannot add element ${addedElement} to ${this} as it is attached to another schema`);
      }
    }
  }
}

// TODO: ideally, we should hide the ctor of this class as we rely in places on the fact the no-one external defines new implementations.
export abstract class NamedSchemaElement<TOwnType extends NamedSchemaElement<TOwnType, TParent, TReferencer>, TParent extends NamedSchemaElement<any, any, any> | Schema, TReferencer> extends SchemaElement<TOwnType, TParent> implements Named {
  // We want to be able to rename some elements, but we prefer offering that through a `rename`
  // method rather than exposing a name setter, as this feel more explicit (but that's arguably debatable).
  // We also currently only offer renames on types (because that's the only one we currently need),
  // though we could expand that.
  protected _name: string;

  constructor(name: string) {
    super();
    this._name = name;
  }

  get name(): string {
    return this._name;
  }

  abstract coordinate: string;

  abstract remove(): TReferencer[];
}

abstract class BaseNamedType<TReferencer, TOwnType extends NamedType & NamedSchemaElement<TOwnType, Schema, TReferencer>> extends NamedSchemaElement<TOwnType, Schema, TReferencer> {
  protected readonly _referencers: Set<TReferencer> = new Set();
  protected readonly _extensions: Set<Extension<TOwnType>> = new Set();

  constructor(name: string, readonly isBuiltIn: boolean = false) {
    super(name);
  }

  private addReferencer(referencer: TReferencer) {
    this._referencers.add(referencer);
  }

  private removeReferencer(referencer: TReferencer) {
    this._referencers.delete(referencer);
  }

  get coordinate(): string {
    return this.name;
  }

  *allChildElements(): Generator<NamedSchemaElement<any, TOwnType, any>, void, undefined> {
    // Overriden by those types that do have children
  }

  extensions(): ReadonlySet<Extension<TOwnType>> {
    return this._extensions;
  }

  newExtension(): Extension<TOwnType> {
    return this.addExtension(new Extension<TOwnType>());
  }

  addExtension(extension: Extension<TOwnType>): Extension<TOwnType> {
    this.checkUpdate();
    // Let's be nice and not complaint if we add an extension already added.
    if (this._extensions.has(extension)) {
      return extension;
    }
    if (extension.extendedElement) {
      throw error(`Cannot add extension to type ${this}: it is already added to another type`);
    }
    this._extensions.add(extension);
    Extension.prototype['setExtendedElement'].call(extension, this);
    this.onModification();
    return extension;
  }

  isIntrospectionType(): boolean {
    return isIntrospectionName(this.name);
  }

  hasExtensionElements(): boolean {
    return this._extensions.size > 0;
  }

  hasNonExtensionElements(): boolean {
    return this._appliedDirectives.some(d => d.ofExtension() === undefined) || this.hasNonExtensionInnerElements();
  }

  protected abstract hasNonExtensionInnerElements(): boolean;

  protected isElementBuiltIn(): boolean {
    return this.isBuiltIn;
  }

  rename(newName: string) {
    // Mostly called to ensure we don't rename built-in types. It does mean we can't renamed detached
    // types while this wouldn't be dangerous, but it's probably not a big deal (the API is designed
    // in such a way that you probably should avoid reusing detached elements).
    this.checkUpdate();
    const oldName = this._name;
    this._name = newName;
    Schema.prototype['renameTypeInternal'].call(this._parent, oldName, newName);
    this.onModification();
  }

  /**
   * Removes this type definition from its parent schema.
   *
   * After calling this method, this type will be "detached": it wil have no parent, schema, fields,
   * values, directives, etc...
   *
   * Note that it is always allowed to remove a type, but this may make a valid schema
   * invalid, and in particular any element that references this type will, after this call, have an undefined
   * reference.
   *
   * @returns an array of all the elements in the schema of this type (before the removal) that were
   * referencing this type (and have thus now an undefined reference).
   */
  remove(): TReferencer[] {
    if (!this._parent) {
      return [];
    }
    this.checkRemoval();
    this.onModification();
    this.removeInnerElements();
    Schema.prototype['removeTypeInternal'].call(this._parent, this);
    this.removeAppliedDirectives();
    this.sourceAST = undefined;
    const toReturn = setValues(this._referencers).map(r => {
      SchemaElement.prototype['removeTypeReferenceInternal'].call(r, this);
      return r;
    });
    this._referencers.clear();
    this._parent = undefined;
    return toReturn;
  }

  referencers(): readonly TReferencer[] {
    return setValues(this._referencers);
  }

  isReferenced(): boolean {
    return this._referencers.size > 0;
  }

  protected abstract removeInnerElements(): void;

  toString(): string {
    return this.name;
  }
}

// TODO: ideally, we should hide the ctor of this class as we rely in places on the fact the no-one external defines new implementations.
export abstract class NamedSchemaElementWithType<TType extends Type, TOwnType extends NamedSchemaElementWithType<TType, TOwnType, P, Referencer>, P extends NamedSchemaElement<any, any, any> | Schema, Referencer> extends NamedSchemaElement<TOwnType, P, Referencer> {
  private _type?: TType;

  get type(): TType | undefined {
    return this._type;
  }

  set type(type: TType | undefined) {
    if (type) {
      this.checkUpdate(type);
    } else {
      this.checkRemoval();
    }
    if (this._type) {
      removeReferenceToType(this, this._type);
    }
    this._type = type;
    if (type) {
      addReferenceToType(this, type);
    }
  }

  protected removeTypeReference(type: NamedType) {
    // We shouldn't have been listed as a reference if we're not one, so make it sure.
    assert(this._type && baseType(this._type) === type, () => `Cannot remove reference to type ${type} on ${this} as its type is ${this._type}`);
    this._type = undefined;
  }
}

function error(message: string): GraphQLError {
  return new GraphQLError(message);
}

abstract class BaseExtensionMember<TExtended extends ExtendableElement> extends Element<TExtended> {
  private _extension?: Extension<TExtended>;

  ofExtension(): Extension<TExtended> | undefined {
    return this._extension;
  }

  setOfExtension(extension: Extension<TExtended> | undefined) {
    this.checkUpdate();
    // See similar comment on FieldDefinition.setOfExtension for why we have to cast.
    if (extension && !this._parent?.extensions().has(extension as any)) {
      throw error(`Cannot set object as part of the provided extension: it is not an extension of parent ${this.parent}`);
    }
    this._extension = extension;
  }

  remove() {
    this.removeInner();
    Schema.prototype['onModification'].call(this.schema());
    this._extension = undefined;
    this._parent = undefined;
  }

  protected abstract removeInner(): void;
}

function sortedMemberNames(u: UnionType): string[] {
  return u.members().map(m => m.type.name).sort((n1, n2) => n1.localeCompare(n2));
}

export class BuiltIns {
  readonly defaultGraphQLBuiltInTypes: readonly string[] = [ 'Int', 'Float', 'String', 'Boolean', 'ID' ];
  private readonly defaultGraphQLBuiltInDirectives: readonly string[] = [ 'include', 'skip', 'deprecated', 'specifiedBy' ];

  addBuiltInTypes(schema: Schema) {
    this.defaultGraphQLBuiltInTypes.forEach(t => this.addBuiltInScalar(schema, t));
  }

  addBuiltInDirectives(schema: Schema) {
    for (const name of ['include', 'skip']) {
      this.addBuiltInDirective(schema, name)
        .addLocations('FIELD', 'FRAGMENT_SPREAD', 'INLINE_FRAGMENT')
        .addArgument('if', new NonNullType(schema.booleanType()));
    }
    this.addBuiltInDirective(schema, 'deprecated')
      .addLocations('FIELD_DEFINITION', 'ENUM_VALUE', 'ARGUMENT_DEFINITION', 'INPUT_FIELD_DEFINITION')
      .addArgument('reason', schema.stringType(), 'No longer supported');
    this.addBuiltInDirective(schema, 'specifiedBy')
      .addLocations('SCALAR')
      .addArgument('url', new NonNullType(schema.stringType()));
  }

  isGraphQLBuiltIn(element: NamedType | DirectiveDefinition | FieldDefinition<any>): boolean {
    if (isIntrospectionName(element.name)) {
      return true;
    }
    if (element instanceof FieldDefinition) {
      return false;
    } else if (element instanceof DirectiveDefinition) {
      return this.defaultGraphQLBuiltInDirectives.includes(element.name);
    } else {
      return this.defaultGraphQLBuiltInTypes.includes(element.name);
    }
  }

  prepareValidation(_: Schema) {
    // No-op for graphQL built-ins, but overriden for federation built-ins.
  }

  onValidation(schema: Schema, unvalidatedDirectives?: string[]): GraphQLError[] {
    const errors: GraphQLError[] = [];
    // We make sure that if any of the built-ins has been redefined, then the redefinition is
    // the same as the built-in one.
    for (const type of schema.builtInTypes(undefined, true)) {
      const maybeRedefined = schema.type(type.name)!;
      if (!maybeRedefined.isBuiltIn) {
        this.ensureSameTypeStructure(type, maybeRedefined, errors);
      }
    }

    for (const directive of schema.builtInDirectives(true)) {
      if (unvalidatedDirectives && unvalidatedDirectives.includes(directive.name)) {
        continue;
      }
      const maybeRedefined = schema.directive(directive.name)!;
      if (!maybeRedefined.isBuiltIn) {
        this.ensureSameDirectiveStructure(directive, maybeRedefined, errors);
      }
    }
    return errors;
  }

  validationRules(): readonly SDLValidationRule[] {
    return specifiedSDLRules;
  }

  maybeUpdateSubgraphDocument(_: Schema, document: DocumentNode): DocumentNode {
    return document;
  }

  private ensureSameDirectiveStructure(builtIn: DirectiveDefinition<any>, manuallyDefined: DirectiveDefinition<any>, errors: GraphQLError[]) {
    this.ensureSameArguments(builtIn, manuallyDefined, `directive ${builtIn}`, errors);
    // It's ok to say you'll never repeat a built-in that is repeatable. It's not ok to repeat one that isn't.
    if (!builtIn.repeatable && manuallyDefined.repeatable) {
      errors.push(error(`Invalid redefinition of built-in directive ${builtIn}: ${builtIn} should${builtIn.repeatable ? "" : " not"} be repeatable`));
    }
    // Similarly, it's ok to say that you will never use a directive in some locations, but not that you will use it in places not allowed by the built-in.
    if (!manuallyDefined.locations.every(loc => builtIn.locations.includes(loc))) {
      errors.push(error(`Invalid redefinition of built-in directive ${builtIn}: ${builtIn} should have locations ${builtIn.locations.join(', ')}, but found (non-subset) ${manuallyDefined.locations.join(', ')}`));
    }
  }

  private ensureSameArguments(
    builtIn: { arguments(): readonly ArgumentDefinition<any>[] },
    manuallyDefined: { argument(name: string): ArgumentDefinition<any> | undefined, arguments(): readonly ArgumentDefinition<any>[] },
    what: string,
    errors: GraphQLError[]
  ) {
    const expectedArguments = builtIn.arguments();
    const foundArguments = manuallyDefined.arguments();
    if (expectedArguments.length !== foundArguments.length) {
      errors.push(error(`Invalid redefinition of built-in ${what}: should have ${expectedArguments.length} arguments but ${foundArguments.length} found in redefinition`));
      return;
    }
    for (const expectedArgument of expectedArguments) {
      const foundArgument = manuallyDefined.argument(expectedArgument.name)!;
      const expectedType = expectedArgument.type!;
      let actualType = foundArgument.type!;
      if (isNonNullType(actualType) && !isNonNullType(expectedType)) {
        // It's ok to redefine an optional argument as mandatory. For instance, if you want to force people on your team to provide a "deprecation reason", you can
        // redefine @deprecated as `directive @deprecated(reason: String!)...` to get validation. In other words, you are allowed to always pass an argument that
        // is optional if you so wish.
        actualType = actualType.ofType;
      }
      if (!sameType(expectedType, actualType)) {
        errors.push(error(`Invalid redefinition of built-in ${what}: ${expectedArgument.coordinate} should have type ${expectedArgument.type!} but found type ${foundArgument.type!}`));
      } else if (!isNonNullType(actualType) && !valueEquals(expectedArgument.defaultValue, foundArgument.defaultValue)) {
        errors.push(error(`Invalid redefinition of built-in ${what}: ${expectedArgument.coordinate} should have default value ${valueToString(expectedArgument.defaultValue)} but found default value ${valueToString(foundArgument.defaultValue)}`));
      }
    }
  }

  private ensureSameTypeStructure(builtIn: NamedType, manuallyDefined: NamedType, errors: GraphQLError[]) {
    if (builtIn.kind !== manuallyDefined.kind) {
      errors.push(error(`Invalid redefinition of built-in type ${builtIn}: ${builtIn} should be a ${builtIn.kind} type but redefined as a ${manuallyDefined.kind}`));
      return;
    }

    switch (builtIn.kind) {
      case 'ScalarType':
        // Nothing more to check for scalars.
        return;
      case 'ObjectType':
        const redefinedObject = manuallyDefined as ObjectType;
        for (const builtInField of builtIn.fields()) {
          const redefinedField = redefinedObject.field(builtInField.name);
          if (!redefinedField) {
            errors.push(error(`Invalid redefinition of built-in type ${builtIn}: redefinition is missing field ${builtInField}`));
            return;
          }
          // We allow adding non-nullability because we've seen redefinition of the federation _Service type with type String! for the `sdl` field
          // and we don't want to break backward compatibility as this doesn't feel too harmful.
          let rType = redefinedField.type!;
          if (!isNonNullType(builtInField.type!) && isNonNullType(rType)) {
            rType = rType.ofType;
          }
          if (!sameType(builtInField.type!, rType)) {
            errors.push(error(`Invalid redefinition of field ${builtInField} of built-in type ${builtIn}: should have type ${builtInField.type} but redefined with type ${redefinedField.type}`));
            return;
          }
          this.ensureSameArguments(builtInField, redefinedField, `field ${builtInField.coordinate}`, errors);
        }
        break;
      case 'UnionType':
        const redefinedUnion = manuallyDefined as UnionType;
        const builtInMembers = sortedMemberNames(builtIn);
        const redefinedMembers = sortedMemberNames(redefinedUnion);
        if (!arrayEquals(builtInMembers, redefinedMembers)) {
          errors.push(error(`Invalid redefinition of built-in type ${builtIn}: redefinition has members [${redefinedMembers}] but should have members [${builtInMembers}]`));
        }
        break;
      default:
        // Let's not bother with the rest until we actually need it.
        errors.push(error(`Invalid redefinition of built-in type ${builtIn}: cannot redefine ${builtIn.kind} built-in types`));
    }
  }

  protected addBuiltInScalar(schema: Schema, name: string): ScalarType {
    return schema.addType(new ScalarType(name, true));
  }

  protected addBuiltInObject(schema: Schema, name: string): ObjectType {
    return schema.addType(new ObjectType(name, true));
  }

  protected addBuiltInUnion(schema: Schema, name: string): UnionType {
    return schema.addType(new UnionType(name, true));
  }

  protected addBuiltInDirective(schema: Schema, name: string): DirectiveDefinition {
    return schema.addDirectiveDefinition(new DirectiveDefinition(name, true));
  }

  protected addBuiltInField(parentType: ObjectType, name: string, type: OutputType): FieldDefinition<ObjectType> {
    return parentType.addField(new FieldDefinition(name, true), type);
  }

  protected getTypedDirective<TApplicationArgs extends {[key: string]: any}>(
    schema: Schema,
    name: string
  ): DirectiveDefinition<TApplicationArgs> {
    const directive = schema.directive(name);
    if (!directive) {
      throw new Error(`The provided schema has not be built with the ${name} directive built-in`);
    }
    return directive as DirectiveDefinition<TApplicationArgs>;
  }

  includeDirective(schema: Schema): DirectiveDefinition<{if: boolean}> {
    return this.getTypedDirective(schema, 'include');
  }

  skipDirective(schema: Schema): DirectiveDefinition<{if: boolean}> {
    return this.getTypedDirective(schema, 'skip');
  }

  deprecatedDirective(schema: Schema): DirectiveDefinition<{reason?: string}> {
    return this.getTypedDirective(schema, 'deprecated');
  }

  specifiedByDirective(schema: Schema): DirectiveDefinition<{url: string}> {
    return this.getTypedDirective(schema, 'specifiedBy');
  }
}

export class CoreFeature {
  constructor(
    readonly url: FeatureUrl,
    readonly nameInSchema: string,
    readonly directive: Directive<SchemaDefinition>,
    readonly purpose?: string,
  ) {
  }

  isFeatureDefinition(element: NamedType | DirectiveDefinition): boolean {
    return element.name.startsWith(this.nameInSchema + '__')
      || (element.kind === 'DirectiveDefinition' && element.name === this.nameInSchema);
  }
}

export class CoreFeatures {
  readonly coreDefinition: CoreSpecDefinition;
  private readonly byAlias: Map<string, CoreFeature> = new Map();
  private readonly byIdentity: Map<string, CoreFeature> = new Map();

  constructor(readonly coreItself: CoreFeature) {
    this.add(coreItself);
    const coreDef = CORE_VERSIONS.find(coreItself.url.version);
    if (!coreDef) {
      throw error(`Schema uses unknown version ${coreItself.url.version} of the core spec (known versions: ${CORE_VERSIONS.versions().join(', ')})`);
    }
    this.coreDefinition = coreDef;
  }

  getByIdentity(identity: string): CoreFeature | undefined {
    return this.byIdentity.get(identity);
  }

  allFeatures(): IterableIterator<CoreFeature> {
    return this.byIdentity.values();
  }

  private removeFeature(featureIdentity: string) {
    const feature = this.byIdentity.get(featureIdentity);
    if (feature) {
      this.byIdentity.delete(featureIdentity);
      this.byAlias.delete(feature.nameInSchema);
    }
  }

  private maybeAddFeature(directive: Directive<SchemaDefinition>): CoreFeature | undefined {
    if (directive.definition?.name !== this.coreItself.nameInSchema) {
      return undefined;
    }
    const args = (directive as Directive<SchemaDefinition, CoreDirectiveArgs>).arguments();
    const url = FeatureUrl.parse(args.feature);
    const existing = this.byIdentity.get(url.identity);
    if (existing) {
      throw error(`Duplicate inclusion of feature ${url.identity}`);
    }
    const feature = new CoreFeature(url, args.as ?? url.name, directive, args.for);
    this.add(feature);
    return feature;
  }

  private add(feature: CoreFeature) {
    this.byAlias.set(feature.nameInSchema, feature);
    this.byIdentity.set(feature.url.identity, feature);
  }
}

const toASTPrintOptions: Options = { ...defaultPrintOptions, showNonGraphQLBuiltIns: true };

export class Schema {
  private _schemaDefinition: SchemaDefinition;
  private readonly _builtInTypes = new MapWithCachedArrays<string, NamedType>();
  private readonly _types = new MapWithCachedArrays<string, NamedType>();
  private readonly _builtInDirectives = new MapWithCachedArrays<string, DirectiveDefinition>();
  private readonly _directives = new MapWithCachedArrays<string, DirectiveDefinition>();
  private _coreFeatures?: CoreFeatures;
  private isConstructed: boolean = false;
  private isValidated: boolean = false;

  private cachedDocument?: DocumentNode;
  private apiSchema?: Schema;

  constructor(readonly builtIns: BuiltIns = graphQLBuiltIns) {
    this._schemaDefinition = new SchemaDefinition();
    Element.prototype['setParent'].call(this._schemaDefinition, this);
    builtIns.addBuiltInTypes(this);
    builtIns.addBuiltInDirectives(this);
    this.isConstructed = true;
  }

  private canModifyBuiltIn(): boolean {
    return !this.isConstructed;
  }

  private runWithBuiltInModificationAllowed(fct: () => void) {
    const wasConstructed = this.isConstructed;
    this.isConstructed = false;
    fct();
    this.isConstructed = wasConstructed;
  }

  private renameTypeInternal(oldName: string, newName: string) {
    this._types.set(newName, this._types.get(oldName)!);
    this._types.delete(oldName);
  }

  private removeTypeInternal(type: BaseNamedType<any, any>) {
    this._types.delete(type.name);
  }

  private removeDirectiveInternal(definition: DirectiveDefinition) {
    this._directives.delete(definition.name);
  }

  private markAsCoreSchema(coreItself: CoreFeature) {
    this._coreFeatures = new CoreFeatures(coreItself);
  }

  private unmarkAsCoreSchema() {
    this._coreFeatures = undefined;
  }

  private onModification() {
    // The only stuffs that are added while !isConstructed are built-in, and those shouldn't invalidate everything.
    if (this.isConstructed) {
      this.invalidate();
      this.cachedDocument = undefined;
      this.apiSchema = undefined;
    }
  }

  private forceSetCachedDocument(document: DocumentNode, addNonGraphQLBuiltIns: boolean = true) {
    this.cachedDocument = addNonGraphQLBuiltIns
    ? this.builtIns.maybeUpdateSubgraphDocument(this, document)
    : document;
  }

  isCoreSchema(): boolean {
    return this.coreFeatures !== undefined;
  }

  get coreFeatures(): CoreFeatures | undefined {
    return this._coreFeatures;
  }

  toAST(): DocumentNode {
    if (!this.cachedDocument) {
      // As we're not building the document from a file, having locations info might be more confusing that not.
      this.forceSetCachedDocument(parse(printSchema(this, toASTPrintOptions), { noLocation: true }), false);
    }
    return this.cachedDocument!;
  }

  toAPISchema(): Schema {
    if (!this.apiSchema) {
      this.validate();

      const apiSchema = this.clone();
      removeInaccessibleElements(apiSchema);
      const coreFeatures = apiSchema.coreFeatures;
      if (coreFeatures) {
        // Note that core being a feature itself, this will remove core itself and mark apiSchema as 'not core'
        for (const coreFeature of coreFeatures.allFeatures()) {
          removeFeatureElements(apiSchema, coreFeature);
        }
      }
      assert(!apiSchema.isCoreSchema(), "The API schema shouldn't be a core schema")
      apiSchema.validate();
      this.apiSchema = apiSchema;
    }
    return this.apiSchema;
  }

  toGraphQLJSSchema(isSubgraph: boolean = false): GraphQLSchema {
    // Obviously not super fast, but as long as we don't use this often on a hot path, that's probably ok.
    if (!isSubgraph) {
      return buildGraphqlSchemaFromAST(this.toAST());
    }

    // Some subgraphs, especially federation 1 ones, cannot be properly converted to a GraphQLSchema because they are invalid graphQL.
    // And the main culprit is type extensions that don't have a corresponding definition. So to avoid that problem, we print
    // up the AST without extensions. Another issue is the non graph built-ins which needs to be explicitely defined.
    const ast = parse(printSchema(this, { ...toASTPrintOptions, mergeTypesAndExtensions: true }), { noLocation: true });
    return buildGraphqlSchemaFromAST(ast);
  }

  get schemaDefinition(): SchemaDefinition {
    return this._schemaDefinition;
  }

  /**
   * All the types defined on this schema, excluding the built-in types.
   */
  types<T extends NamedType>(kind?: T['kind'], includeNonGraphQLBuiltIns: boolean = false): readonly T[] {
    const allKinds = this._types.values();
    const forKind = (kind ? allKinds.filter(t => t.kind === kind) : allKinds) as readonly T[];
    return includeNonGraphQLBuiltIns
      ? this.builtInTypes(kind).filter(t => !graphQLBuiltIns.isGraphQLBuiltIn(t)).concat(forKind)
      : forKind;
  }

  /**
   * All the built-in types for this schema (those that are not displayed when printing the schema).
   */
  builtInTypes<T extends NamedType>(kind?: T['kind'], includeShadowed: boolean = false): readonly T[] {
    const allBuiltIns = this._builtInTypes.values();
    const forKind = (kind ? allBuiltIns.filter(t => t.kind === kind) : allBuiltIns) as readonly T[];
    return includeShadowed
      ? forKind
      : forKind.filter(t => !this.isShadowedBuiltInType(t));
  }

  private isShadowedBuiltInType(type: NamedType) {
    return type.isBuiltIn && this._types.has(type.name);
  }

  /**
    * All the types, including the built-in ones.
    */
  allTypes<T extends NamedType>(kind?: T['kind']): readonly T[] {
    return this.builtInTypes(kind).concat(this.types(kind));
  }

  /**
   * The type of the provide name in this schema if one is defined or if it is the name of a built-in.
   */
  type(name: string): NamedType | undefined {
    const type = this._types.get(name);
    return type ? type : this._builtInTypes.get(name);
  }

  typeOfKind<T extends NamedType>(name: string, kind: T['kind']): T | undefined {
    const type = this.type(name);
    return type && type.kind === kind ? type as T : undefined;
  }

  intType(): ScalarType {
    return this._builtInTypes.get('Int')! as ScalarType;
  }

  floatType(): ScalarType {
    return this._builtInTypes.get('Float')! as ScalarType;
  }

  stringType(): ScalarType {
    return this._builtInTypes.get('String')! as ScalarType;
  }

  booleanType(): ScalarType {
    return this._builtInTypes.get('Boolean')! as ScalarType;
  }

  idType(): ScalarType {
    return this._builtInTypes.get('ID')! as ScalarType;
  }

  addType<T extends NamedType>(type: T): T {
    const existing = this.type(type.name);
    // Like for directive, we let use shadow built-in types, but validation will ensure the definition is compatible.
    if (existing && !existing.isBuiltIn) {
      throw error(`Type ${type} already exists in this schema`);
    }
    if (type.isAttached()) {
      // For convenience, let's not error out on adding an already added type.
      if (type.parent == this) {
        return type;
      }
      throw error(`Cannot add type ${type} to this schema; it is already attached to another schema`);
    }
    if (type.isBuiltIn) {
      if (!this.isConstructed) {
        this._builtInTypes.set(type.name, type);
      } else {
        throw error(`Cannot add built-in ${type} to this schema (built-ins can only be added at schema construction time)`);
      }
    } else {
      this._types.set(type.name, type);
    }
    Element.prototype['setParent'].call(type, this);
    // If a type is the default name of a root, it "becomes" that root automatically,
    // unless some other root has already been set.
    const defaultSchemaRoot = checkDefaultSchemaRoot(type);
    if (defaultSchemaRoot && !this.schemaDefinition.root(defaultSchemaRoot)) {
      // Note that checkDefaultSchemaRoot guarantees us type is an ObjectType
      this.schemaDefinition.setRoot(defaultSchemaRoot, type as ObjectType);
    }
    this.onModification();
    return type;
  }

  /**
   * All the directive defined on this schema, excluding the built-in directives.
   */
  directives(includeNonGraphQLBuiltIns: boolean = false): readonly DirectiveDefinition[] {
    return includeNonGraphQLBuiltIns
      ? this.builtInDirectives().filter(d => !graphQLBuiltIns.isGraphQLBuiltIn(d)).concat(this._directives.values())
      : this._directives.values();
  }

  /**
   * All the built-in directives for this schema (those that are not displayed when printing the schema).
   */
  builtInDirectives(includeShadowed: boolean = false): readonly DirectiveDefinition[] {
    return includeShadowed
      ? this._builtInDirectives.values()
      : this._builtInDirectives.values().filter(d => !this.isShadowedBuiltInDirective(d));
  }

  allDirectives(): readonly DirectiveDefinition[] {
    return this.builtInDirectives().concat(this.directives());
  }

  private isShadowedBuiltInDirective(directive: DirectiveDefinition) {
    return directive.isBuiltIn && this._directives.has(directive.name);
  }

  directive(name: string): DirectiveDefinition | undefined {
    const directive = this._directives.get(name);
    return directive ? directive : this._builtInDirectives.get(name);
  }

  *allNamedSchemaElement(): Generator<NamedSchemaElement<any, any, any>, void, undefined> {
    for (const type of this.types()) {
      yield type;
      yield* type.allChildElements();
    }
    for (const directive of this.directives()) {
      yield directive;
      yield* directive.arguments();
    }
  }

  *allSchemaElement(): Generator<SchemaElement<any, any>, void, undefined> {
    yield this._schemaDefinition;
    yield* this.allNamedSchemaElement();
  }

  addDirectiveDefinition(name: string): DirectiveDefinition;
  addDirectiveDefinition(directive: DirectiveDefinition): DirectiveDefinition;
  addDirectiveDefinition(directiveOrName: string | DirectiveDefinition): DirectiveDefinition {
    const definition = typeof directiveOrName === 'string' ? new DirectiveDefinition(directiveOrName) : directiveOrName;
    const existing = this.directive(definition.name);
    // Note that we allow the schema to define a built-in manually (and the manual definition will shadow the
    // built-in one). It's just that validation will ensure the definition ends up the one expected.
    if (existing && !existing.isBuiltIn) {
      throw error(`Directive ${definition} already exists in this schema`);
    }
    if (definition.isAttached()) {
      // For convenience, let's not error out on adding an already added directive.
      if (definition.parent == this) {
        return definition;
      }
      throw error(`Cannot add directive ${definition} to this schema; it is already attached to another schema`);
    }
    if (definition.isBuiltIn) {
      if (!this.isConstructed) {
        this._builtInDirectives.set(definition.name, definition);
      } else {
        throw error(`Cannot add built-in ${definition} to this schema (built-ins can only be added at schema construction time)`);
      }
    } else {
      this._directives.set(definition.name, definition);
    }
    Element.prototype['setParent'].call(definition, this);
    this.onModification();
    return definition;
  }

  invalidate() {
    this.isValidated = false;
  }

  validate() {
    if (this.isValidated) {
      return;
    }

    // This needs to run _before_ graphQL validation: otherwise, the _Entity union will be empty and fail validation.
    this.runWithBuiltInModificationAllowed(() => {
      this.builtIns.prepareValidation(this);
      addIntrospectionFields(this);
    });

    // TODO: we should ensure first that there is no undefined types (or maybe throw properly when printing the AST
    // and catching that properly).
    let errors: GraphQLError[] = validateSDL(this.toAST(), undefined, this.builtIns.validationRules());
    errors = errors.concat(validateSchema(this));

    // We avoid adding federation-specific validations if the base schema is not proper graphQL as the later can easily trigger
    // the former (for instance, someone mistyping the 'fields' argument name of a @key).
    if (errors.length === 0) {
      this.runWithBuiltInModificationAllowed(() => {
        errors = this.builtIns.onValidation(this);
      });
    }

    if (errors.length > 0) {
      throw ErrGraphQLValidationFailed(errors);
    }

    this.isValidated = true;
  }

  clone(builtIns?: BuiltIns): Schema {
    const cloned = new Schema(builtIns ?? this.builtIns);
    copy(this, cloned);
    if (this.isValidated) {
      // TODO: when we do actual validation, no point in redoing it, but we should
      // at least call builtIns.onValidation() and set the proper isConstructed/isValidated flags.
      cloned.validate();
    }
    return cloned;
  }
}

export class RootType extends BaseExtensionMember<SchemaDefinition> {
  constructor(readonly rootKind: SchemaRootKind, readonly type: ObjectType) {
    super();
  }

  isDefaultRootName() {
    return defaultRootName(this.rootKind) == this.type.name;
  }

  protected removeInner() {
    SchemaDefinition.prototype['removeRootType'].call(this._parent, this);
  }
}

export class SchemaDefinition extends SchemaElement<SchemaDefinition, Schema>  {
  readonly kind = 'SchemaDefinition' as const;
  protected readonly _roots = new MapWithCachedArrays<SchemaRootKind, RootType>();
  protected readonly _extensions = new Set<Extension<SchemaDefinition>>();

  roots(): readonly RootType[] {
    return this._roots.values();
  }

  applyDirective<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}>(
    nameOrDefOrDirective: Directive<SchemaDefinition, TApplicationArgs> | DirectiveDefinition<TApplicationArgs> | string,
    args?: TApplicationArgs
  ): Directive<SchemaDefinition, TApplicationArgs> {
    const applied = super.applyDirective(nameOrDefOrDirective, args) as Directive<SchemaDefinition, TApplicationArgs>;
    const schema = this.schema();
    const coreFeatures = schema.coreFeatures;
    if (isCoreSpecDirectiveApplication(applied)) {
      if (coreFeatures) {
        throw error(`Invalid duplicate application of the @core feature`);
      }
      const schemaDirective = applied as Directive<SchemaDefinition, CoreDirectiveArgs>;
      const args = schemaDirective.arguments();
      const url = FeatureUrl.parse(args.feature);
      const core = new CoreFeature(url, args.as ?? 'core', schemaDirective, args.for);
      Schema.prototype['markAsCoreSchema'].call(schema, core);
    } else if (coreFeatures) {
      CoreFeatures.prototype['maybeAddFeature'].call(coreFeatures, applied);
    }
    this.onModification();
    return applied;
  }

  root(rootKind: SchemaRootKind): RootType | undefined {
    return this._roots.get(rootKind);
  }

  rootType(rootKind: SchemaRootKind): ObjectType | undefined {
    return this.root(rootKind)?.type;
  }

  setRoot(rootKind: SchemaRootKind, nameOrType: ObjectType | string): RootType {
    let toSet: RootType;
    if (typeof nameOrType === 'string') {
      this.checkUpdate();
      const obj = this.schema().type(nameOrType);
      if (!obj) {
        throw new GraphQLError(`Cannot set schema ${rootKind} root to unknown type ${nameOrType}`);
      } else if (obj.kind != 'ObjectType') {
        throw new GraphQLError(`${defaultRootName(rootKind)} root type must be an Object type${rootKind === 'query' ? '' : ' if provided'}, it cannot be set to ${nameOrType} (an ${obj.kind}).`);
      }
      toSet = new RootType(rootKind, obj);
    } else {
      this.checkUpdate(nameOrType);
      toSet = new RootType(rootKind, nameOrType);
    }
    const prevRoot = this._roots.get(rootKind);
    if (prevRoot) {
      removeReferenceToType(this, prevRoot.type);
    }
    this._roots.set(rootKind, toSet);
    Element.prototype['setParent'].call(toSet, this);
    addReferenceToType(this, toSet.type);
    this.onModification();
    return toSet;
  }

  extensions(): ReadonlySet<Extension<SchemaDefinition>> {
    return this._extensions;
  }

  newExtension(): Extension<SchemaDefinition> {
    return this.addExtension(new Extension());
  }

  addExtension(extension: Extension<SchemaDefinition>): Extension<SchemaDefinition> {
    this.checkUpdate();
    // Let's be nice and not complaint if we add an extension already added.
    if (this._extensions.has(extension)) {
      return extension;
    }
    if (extension.extendedElement) {
      throw error(`Cannot add extension to this schema: extension is already added to another schema`);
    }
    this._extensions.add(extension);
    Extension.prototype['setExtendedElement'].call(extension, this);
    this.onModification();
    return extension;
  }

  private removeRootType(rootType: RootType) {
    this._roots.delete(rootType.rootKind);
    removeReferenceToType(this, rootType.type);
  }

  protected removeTypeReference(toRemove: NamedType) {
    for (const rootType of this.roots()) {
      if (rootType.type == toRemove) {
        this._roots.delete(rootType.rootKind);
      }
    }
  }

  toString() {
    return `schema[${this._roots.keys().join(', ')}]`;
  }
}

export class ScalarType extends BaseNamedType<OutputTypeReferencer | InputTypeReferencer, ScalarType> {
  readonly kind = 'ScalarType' as const;

  protected removeTypeReference(type: NamedType) {
    assert(false, `Scalar type ${this} can't reference other types; shouldn't be asked to remove reference to ${type}`);
  }

  protected hasNonExtensionInnerElements(): boolean {
    return false; // No inner elements
  }

  protected removeInnerElements(): void {
    // No inner elements
  }
}

export class InterfaceImplementation<T extends ObjectType | InterfaceType> extends BaseExtensionMember<T> {
  readonly interface: InterfaceType

  // Note: typescript complains if a parameter is named 'interface'. This is why we don't just declare the `readonly interface`
  // field within the constructor.
  constructor(itf: InterfaceType) {
    super();
    this.interface = itf;
  }

  protected removeInner() {
    FieldBasedType.prototype['removeInterfaceImplementation'].call(this._parent, this.interface);
  }

  toString() {
    return `'implements ${this.interface}'`;
  }
}

// Abstract class for ObjectType and InterfaceType as they share most of their structure. Note that UnionType also
// technically has one field (__typename), but because it's only one, it is special cased and UnionType is not a
// subclass of this class.
abstract class FieldBasedType<T extends (ObjectType | InterfaceType) & NamedSchemaElement<T, Schema, R>, R> extends BaseNamedType<R, T> {
  // Note that we only keep one InterfaceImplementation per interface name, and so each `implements X` belong
  // either to the main type definition _or_ to a single extension. In theory, a document could have `implements X`
  // in both of those places (or on 2 distinct extensions). We don't preserve that level of detail, but this
  // feels like a very minor limitation with little practical impact, and it avoids additional complexity.
  private readonly _interfaceImplementations: MapWithCachedArrays<string, InterfaceImplementation<T>> = new MapWithCachedArrays();
  private readonly _fields: MapWithCachedArrays<string, FieldDefinition<T>> = new MapWithCachedArrays();
  private _cachedNonBuiltInFields?: readonly FieldDefinition<T>[];

  protected onAttached() {
    // Note that we can only add the __typename built-in field when we're attached, because we need access to the
    // schema string type. Also, we're effectively modifying a built-in (to add the type), so we
    // need to let the schema accept it.
    Schema.prototype['runWithBuiltInModificationAllowed'].call(this.schema(), () => {
      this.addField(new FieldDefinition(typenameFieldName, true), new NonNullType(this.schema().stringType()));
    });
  }

  private removeFieldInternal(field: FieldDefinition<T>) {
    this._fields.delete(field.name);
    this._cachedNonBuiltInFields = undefined;
  }

  interfaceImplementations(): readonly InterfaceImplementation<T>[] {
    return this._interfaceImplementations.values();
  }

  interfaceImplementation(type: string | InterfaceType): InterfaceImplementation<T> | undefined {
    return this._interfaceImplementations.get(typeof type === 'string' ? type : type.name);
  }

  interfaces(): readonly InterfaceType[] {
    return this.interfaceImplementations().map(impl => impl.interface);
  }

  implementsInterface(type: string | InterfaceType): boolean {
    return this._interfaceImplementations.has(typeof type === 'string' ? type : type.name);
  }

  addImplementedInterface(nameOrItfOrItfImpl: InterfaceImplementation<T> | InterfaceType | string): InterfaceImplementation<T> {
    let toAdd: InterfaceImplementation<T>;
    if (nameOrItfOrItfImpl instanceof InterfaceImplementation) {
      this.checkUpdate(nameOrItfOrItfImpl);
      toAdd = nameOrItfOrItfImpl;
    } else {
      let itf: InterfaceType;
      if (typeof nameOrItfOrItfImpl === 'string') {
        this.checkUpdate();
        const maybeItf = this.schema().type(nameOrItfOrItfImpl);
        if (!maybeItf) {
          throw new GraphQLError(`Cannot implement unknown type ${nameOrItfOrItfImpl}`);
        } else if (maybeItf.kind != 'InterfaceType') {
          throw new GraphQLError(`Cannot implement non-interface type ${nameOrItfOrItfImpl} (of type ${maybeItf.kind})`);
        }
        itf = maybeItf;
      } else {
        itf = nameOrItfOrItfImpl;
      }
      toAdd = new InterfaceImplementation<T>(itf);
    }
    const existing = this._interfaceImplementations.get(toAdd.interface.name);
    if (!existing) {
      this._interfaceImplementations.set(toAdd.interface.name, toAdd);
      addReferenceToType(this, toAdd.interface);
      Element.prototype['setParent'].call(toAdd, this);
      this.onModification();
      return toAdd;
    } else {
      return existing;
    }
  }

  /**
   * All the fields of this type, excluding the built-in ones.
   */
  fields(includeNonGraphQLBuiltIns: boolean = false): readonly FieldDefinition<T>[] {
    if (includeNonGraphQLBuiltIns) {
      return this.allFields().filter(f => !graphQLBuiltIns.isGraphQLBuiltIn(f));
    }
    if (!this._cachedNonBuiltInFields) {
      this._cachedNonBuiltInFields = this._fields.values().filter(f => !f.isBuiltIn);
    }
    return this._cachedNonBuiltInFields;
  }

  hasFields(includeNonGraphQLBuiltIns: boolean = false): boolean {
    return this.fields(includeNonGraphQLBuiltIns).length > 0;
  }

  /**
   * All the built-in fields for this type (those that are not displayed when printing the schema).
   */
  builtInFields(): FieldDefinition<T>[] {
    return this.allFields().filter(f => f.isBuiltIn);
  }

  /**
    * All the fields of this type, including the built-in ones.
    */
  allFields(): readonly FieldDefinition<T>[] {
    return this._fields.values();
  }

  field(name: string): FieldDefinition<T> | undefined {
    return this._fields.get(name);
  }

  /**
   * A shortcut to access the __typename field.
   *
   * Note that an _attached_ (field-based) type will always have this field, but _detached_ types won't, so this method
   * will only return `undefined` on detached objects.
   */
  typenameField(): FieldDefinition<T> | undefined {
    return this.field(typenameFieldName);
  }

  addField(nameOrField: string | FieldDefinition<T>, type?: Type): FieldDefinition<T> {
    let toAdd: FieldDefinition<T>;
    if (typeof nameOrField === 'string') {
      this.checkUpdate();
      toAdd = new FieldDefinition<T>(nameOrField);
    } else {
      this.checkUpdate(nameOrField);
      toAdd = nameOrField;
    }
    if (this.field(toAdd.name)) {
      throw error(`Field ${toAdd.name} already exists on ${this}`);
    }
    if (type && !isOutputType(type)) {
      throw error(`Invalid input type ${type} for field ${toAdd.name}: object and interface field types should be output types.`);
    }
    this._fields.set(toAdd.name, toAdd);
    this._cachedNonBuiltInFields = undefined;
    Element.prototype['setParent'].call(toAdd, this);
    // Note that we need to wait we have attached the field to set the type.
    if (type) {
      toAdd.type = type;
    }
    this.onModification();
    return toAdd;
  }

  *allChildElements(): Generator<NamedSchemaElement<any, any, any>, void, undefined> {
    for (const field of this._fields.values()) {
      yield field;
      yield* field.arguments();
    }
  }

  private removeInterfaceImplementation(itf: InterfaceType) {
    this._interfaceImplementations.delete(itf.name);
    removeReferenceToType(this, itf);
  }

  protected removeTypeReference(type: NamedType) {
    this._interfaceImplementations.delete(type.name);
  }

  protected removeInnerElements(): void {
    for (const interfaceImpl of this.interfaceImplementations()) {
      interfaceImpl.remove();
    }
    for (const field of this.allFields()) {
      if (field.isBuiltIn) {
        // Calling remove on a built-in (think _typename) throws, with reason (we don't want
        // to allow removing _typename from a type in general). So all we do for built-in is
        // detach the parent.
        FieldDefinition.prototype['removeParent'].call(field);
      } else {
        field.remove();
      }
    }
  }

  protected hasNonExtensionInnerElements(): boolean {
    return this.interfaceImplementations().some(itf => itf.ofExtension() === undefined)
      || this.fields().some(f => f.ofExtension() === undefined);
  }
}

export class ObjectType extends FieldBasedType<ObjectType, ObjectTypeReferencer> {
  readonly kind = 'ObjectType' as const;

  /**
   *  Whether this type is one of the schema root type (will return false if the type is detached).
   */
  isRootType(): boolean {
    const schema = this.schema();
    return schema.schemaDefinition.roots().some(rt => rt.type == this);
  }

  /**
   *  Whether this type is the "query" root type of the schema (will return false if the type is detached).
   */
  isQueryRootType(): boolean {
    const schema = this.schema();
    return schema.schemaDefinition.root('query')?.type === this;
  }
}

export class InterfaceType extends FieldBasedType<InterfaceType, InterfaceTypeReferencer> {
  readonly kind = 'InterfaceType' as const;

  allImplementations(): (ObjectType | InterfaceType)[] {
    return setValues(this._referencers).filter(ref => ref.kind === 'ObjectType' || ref.kind === 'InterfaceType') as (ObjectType | InterfaceType)[];
  }

  possibleRuntimeTypes(): readonly ObjectType[] {
    // Note that object types in GraphQL needs to reference directly all the interfaces they implement, and cannot rely on transitivity.
    return this.allImplementations().filter(impl => impl.kind === 'ObjectType') as ObjectType[];
  }

  isPossibleRuntimeType(type: string | NamedType): boolean {
    const typeName = typeof type === 'string' ? type : type.name;
    return this.possibleRuntimeTypes().some(t => t.name == typeName);
  }
}

export class UnionMember extends BaseExtensionMember<UnionType> {
  constructor(readonly type: ObjectType) {
    super();
  }

  protected removeInner() {
    UnionType.prototype['removeMember'].call(this._parent, this.type);
  }
}

export class UnionType extends BaseNamedType<OutputTypeReferencer, UnionType> {
  readonly kind = 'UnionType' as const;
  protected readonly _members: MapWithCachedArrays<string, UnionMember> = new MapWithCachedArrays();
  private _typenameField?: FieldDefinition<UnionType>;

  protected onAttached() {
    // Note that we can only create the __typename built-in field when we're attached, because we need access to the
    // schema string type. Also, we're effectively modifying a built-in (to add the type), so we
    // need to let the schema accept it.
    Schema.prototype['runWithBuiltInModificationAllowed'].call(this.schema(), () => {
      this._typenameField = new FieldDefinition(typenameFieldName, true);
      Element.prototype['setParent'].call(this._typenameField, this);
      this._typenameField.type = new NonNullType(this.schema().stringType());
    });
  }

  types(): ObjectType[] {
    return this.members().map(m => m.type);
  }

  members(): readonly UnionMember[] {
    return this._members.values();
  }

  membersCount(): number {
    return this._members.size;
  }

  hasTypeMember(type: string | ObjectType) {
    return this._members.has(typeof type === 'string' ? type : type.name);
  }

  addType(nameOrTypeOrMember: ObjectType | string | UnionMember): UnionMember {
    let toAdd: UnionMember;
    if (nameOrTypeOrMember instanceof UnionMember) {
      this.checkUpdate(nameOrTypeOrMember);
      toAdd = nameOrTypeOrMember;
    } else {
      let obj: ObjectType;
      if (typeof nameOrTypeOrMember === 'string') {
        this.checkUpdate();
        const maybeObj = this.schema().type(nameOrTypeOrMember);
        if (!maybeObj) {
          throw new GraphQLError(`Cannot add unknown type ${nameOrTypeOrMember} as member of union type ${this.name}`);
        } else if (maybeObj.kind != 'ObjectType') {
          throw new GraphQLError(`Cannot add non-object type ${nameOrTypeOrMember} (of type ${maybeObj.kind}) as member of union type ${this.name}`);
        }
        obj = maybeObj;
      } else {
        this.checkUpdate(nameOrTypeOrMember);
        obj = nameOrTypeOrMember;
      }
      toAdd = new UnionMember(obj);
    }
    const existing = this._members.get(toAdd.type.name);
    if (!existing) {
      this._members.set(toAdd.type.name, toAdd);
      Element.prototype['setParent'].call(toAdd, this);
      addReferenceToType(this, toAdd.type);
      this.onModification();
      return toAdd;
    } else {
      return existing;
    }
  }

  clearTypes() {
    for (const type of this.types()) {
      this.removeMember(type);
    }
    this.onModification();
  }

  /**
   * Access a field of the union by name.
   * As the only field that can be accessed on an union is the __typename one, this method will always return undefined unless called
   * on "__typename". However, this exists to allow code working on CompositeType to be more generic.
   */
  field(name: string): FieldDefinition<UnionType> | undefined {
    if (name === typenameFieldName && this._typenameField) {
      return this._typenameField;
    }
    return undefined;
  }

  /**
   * The __typename field (and only field of a union).
   *
   * Note that _attached_ unions always have this field, so this method will only return `undefined` on detached objects.
   */
  typenameField(): FieldDefinition<UnionType> | undefined {
    return this._typenameField;
  }

  private removeMember(type: ObjectType) {
    this._members.delete(type.name);
    removeReferenceToType(this, type);
  }

  protected removeTypeReference(type: NamedType) {
    this._members.delete(type.name);
  }

  protected removeInnerElements(): void {
    for (const member of this.members()) {
      member.remove();
    }
  }

  protected hasNonExtensionInnerElements(): boolean {
    return this.members().some(m => m.ofExtension() === undefined);
  }
}

export class EnumType extends BaseNamedType<OutputTypeReferencer, EnumType> {
  readonly kind = 'EnumType' as const;
  protected readonly _values: EnumValue[] = [];

  get values(): readonly EnumValue[] {
    return this._values;
  }

  value(name: string): EnumValue | undefined {
    return this._values.find(v => v.name == name);
  }

  addValue(value: EnumValue): EnumValue;
  addValue(name: string): EnumValue;
  addValue(nameOrValue: EnumValue | string): EnumValue {
    let toAdd: EnumValue;
    if (typeof nameOrValue === 'string') {
      this.checkUpdate();
      toAdd = new EnumValue(nameOrValue);
    } else {
      this.checkUpdate(nameOrValue);
      toAdd = nameOrValue;
    }
    const existing = this.value(toAdd.name);
    if (!existing) {
      this._values.push(toAdd);
      Element.prototype['setParent'].call(toAdd, this);
      this.onModification();
      return toAdd;
    } else {
      return existing;
    }
  }

  protected removeTypeReference(type: NamedType) {
    assert(false, `Eum type ${this} can't reference other types; shouldn't be asked to remove reference to ${type}`);
  }

  private removeValueInternal(value: EnumValue) {
    const index = this._values.indexOf(value);
    if (index >= 0) {
      this._values.splice(index, 1);
    }
  }

  protected removeInnerElements(): void {
    this._values.splice(0, this._values.length);
  }

  protected hasNonExtensionInnerElements(): boolean {
    return this._values.some(v => v.ofExtension() === undefined);
  }
}

export class InputObjectType extends BaseNamedType<InputTypeReferencer, InputObjectType> {
  readonly kind = 'InputObjectType' as const;
  private readonly _fields: Map<string, InputFieldDefinition> = new Map();
  private _cachedFieldsArray?: InputFieldDefinition[];

  /**
   * All the fields of this input type.
   */
  fields(): InputFieldDefinition[] {
    if (!this._cachedFieldsArray) {
      this._cachedFieldsArray = mapValues(this._fields);
    }
    return this._cachedFieldsArray;
  }

  field(name: string): InputFieldDefinition | undefined {
    return this._fields.get(name);
  }

  addField(field: InputFieldDefinition): InputFieldDefinition;
  addField(name: string, type?: Type): InputFieldDefinition;
  addField(nameOrField: string | InputFieldDefinition, type?: Type): InputFieldDefinition {
    const toAdd = typeof nameOrField === 'string' ? new InputFieldDefinition(nameOrField) : nameOrField;
    this.checkUpdate(toAdd);
    if (this.field(toAdd.name)) {
      throw error(`Field ${toAdd.name} already exists on ${this}`);
    }
    if (type && !isInputType(type)) {
      throw error(`Invalid output type ${type} for field ${toAdd.name}: input field types should be input types.`);
    }
    this._fields.set(toAdd.name, toAdd);
    this._cachedFieldsArray = undefined;
    Element.prototype['setParent'].call(toAdd, this);
    // Note that we need to wait we have attached the field to set the type.
    if (typeof nameOrField === 'string' && type) {
      toAdd.type = type;
    }
    this.onModification();
    return toAdd;
  }

  hasFields(): boolean {
    return this._fields.size > 0;
  }

  *allChildElements(): Generator<NamedSchemaElement<any, any, any>, void, undefined> {
    yield* this._fields.values();
  }

  protected removeTypeReference(type: NamedType) {
    assert(false, `Input Object type ${this} can't reference other types; shouldn't be asked to remove reference to ${type}`);
  }

  protected removeInnerElements(): void {
    // Not that we modify the type during iteration, but the reference we get from `this.fields()` will not change
    for (const field of this.fields()) {
      field.remove();
    }
  }

  private removeFieldInternal(field: InputFieldDefinition) {
    this._fields.delete(field.name);
    this._cachedFieldsArray = undefined;
  }

  protected hasNonExtensionInnerElements(): boolean {
    return this.fields().some(f => f.ofExtension() === undefined);
  }
}

class BaseWrapperType<T extends Type> {
  protected constructor(protected _type: T) {
    assert(this._type, 'Cannot wrap an undefined/null type');
  }

  schema(): Schema {
    return this.baseType().schema();
  }

  isAttached(): boolean {
    return this.baseType().isAttached();
  }

  get ofType(): T {
    return this._type;
  }

  baseType(): NamedType {
    return baseType(this._type);
  }
}

export class ListType<T extends Type> extends BaseWrapperType<T> {
  readonly kind = 'ListType' as const;

  constructor(type: T) {
    super(type);
  }

  toString(): string {
    return `[${this.ofType}]`;
  }
}

export class NonNullType<T extends NullableType> extends BaseWrapperType<T> {
  readonly kind = 'NonNullType' as const;

  constructor(type: T) {
    super(type);
  }

  toString(): string {
    return `${this.ofType}!`;
  }
}

export class FieldDefinition<TParent extends CompositeType> extends NamedSchemaElementWithType<OutputType, FieldDefinition<TParent>, TParent, never> {
  readonly kind = 'FieldDefinition' as const;
  private readonly _args: MapWithCachedArrays<string, ArgumentDefinition<FieldDefinition<TParent>>> = new MapWithCachedArrays();
  private _extension?: Extension<TParent>;

  constructor(name: string, readonly isBuiltIn: boolean = false) {
    super(name);
  }

  protected isElementBuiltIn(): boolean {
    return this.isBuiltIn;
  }

  get coordinate(): string {
    const parent = this._parent;
    return `${parent == undefined ? '<detached>' : parent.coordinate}.${this.name}`;
  }

  hasArguments(): boolean {
    return this._args.size > 0;
  }

  arguments(): readonly ArgumentDefinition<FieldDefinition<TParent>>[] {
    return this._args.values();
  }

  argument(name: string): ArgumentDefinition<FieldDefinition<TParent>> | undefined {
    return this._args.get(name);
  }

  addArgument(arg: ArgumentDefinition<FieldDefinition<TParent>>): ArgumentDefinition<FieldDefinition<TParent>>;
  addArgument(name: string, type?: Type, defaultValue?: any): ArgumentDefinition<FieldDefinition<TParent>>;
  addArgument(nameOrArg: string | ArgumentDefinition<FieldDefinition<TParent>>, type?: Type, defaultValue?: any): ArgumentDefinition<FieldDefinition<TParent>> {
    let toAdd: ArgumentDefinition<FieldDefinition<TParent>>;
    if (typeof nameOrArg === 'string') {
      this.checkUpdate();
      toAdd = new ArgumentDefinition<FieldDefinition<TParent>>(nameOrArg);
      toAdd.defaultValue = defaultValue;
    } else {
      this.checkUpdate(nameOrArg);
      toAdd = nameOrArg;
    }
    const existing = this.argument(toAdd.name);
    if (existing) {
      // For some reason (bad codegen, maybe?), some users have field where a arg is defined more than one. And this doesn't seem rejected by
      // graphQL (?). So we accept it, but ensure the types/default values are the same.
      if (type && existing.type && !sameType(type, existing.type)) {
        throw error(`Argument ${toAdd.name} already exists on field ${this.name} with a different type (${existing.type})`);
      }
      if (defaultValue && (!existing.defaultValue || !valueEquals(defaultValue, existing.defaultValue))) {
        throw error(`Argument ${toAdd.name} already exists on field ${this.name} with a different default value (${valueToString(existing.defaultValue)})`);
      }
      return existing;
    }
    if (type && !isInputType(type)) {
      throw error(`Invalid output type ${type} for argument ${toAdd.name} of ${this}: arguments should be input types.`);
    }
    this._args.set(toAdd.name, toAdd);
    Element.prototype['setParent'].call(toAdd, this);
    if (typeof nameOrArg === 'string') {
      toAdd.type = type;
    }
    this.onModification();
    return toAdd;
  }

  ofExtension(): Extension<TParent> | undefined {
    return this._extension;
  }

  setOfExtension(extension: Extension<TParent> | undefined) {
    this.checkUpdate();
    // It seems typescript "expand" `TParent` below into `ObjectType | Interface`, so it essentially lose the context that
    // the `TParent` in `Extension<TParent>` will always match. Hence the `as any`.
    if (extension && !this._parent?.extensions().has(extension as any)) {
      throw error(`Cannot mark field ${this.name} as part of the provided extension: it is not an extension of field parent type ${this.parent}`);
    }
    this._extension = extension;
    this.onModification();
  }

  isIntrospectionField(): boolean {
    return isIntrospectionName(this.name);
  }

  isSchemaIntrospectionField(): boolean {
    return introspectionFieldNames.includes(this.name);
  }

  private removeArgumentInternal(name: string) {
    this._args.delete(name);
  }

  // Only called through the prototype from FieldBasedType.removeInnerElements because we don't want to expose it.
  private removeParent() {
    this._parent = undefined;
  }

  isDeprecated(): boolean {
    return this.hasAppliedDirective('deprecated');
  }

  /**
   * Removes this field definition from its parent type.
   *
   * After calling this method, this field definition will be "detached": it wil have no parent, schema, type,
   * arguments or directives.
   */
  remove(): never[] {
    if (!this._parent) {
      return [];
    }
    this.onModification();
    this.removeAppliedDirectives();
    this.type = undefined;
    this._extension = undefined;
    for (const arg of this.arguments()) {
      arg.remove();
    }
    FieldBasedType.prototype['removeFieldInternal'].call(this._parent, this);
    this._parent = undefined;
    // Fields have nothing that can reference them outside of their parents
    return [];
  }

  toString(): string {
    const args = this._args.size == 0
      ? ""
      : '(' + this.arguments().map(arg => arg.toString()).join(', ') + ')';
    return `${this.name}${args}: ${this.type}`;
  }
}

export class InputFieldDefinition extends NamedSchemaElementWithType<InputType, InputFieldDefinition, InputObjectType, never> {
  readonly kind = 'InputFieldDefinition' as const;
  private _extension?: Extension<InputObjectType>;
  defaultValue?: any

  get coordinate(): string {
    const parent = this._parent;
    return `${parent == undefined ? '<detached>' : parent.coordinate}.${this.name}`;
  }

  isRequired(): boolean {
    return isNonNullType(this.type!) && this.defaultValue === undefined;
  }

  ofExtension(): Extension<InputObjectType> | undefined {
    return this._extension;
  }

  setOfExtension(extension: Extension<InputObjectType> | undefined) {
    this.checkUpdate();
    // It seems typescript "expand" `TParent` below into `ObjectType | Interface`, so it essentially lose the context that
    // the `TParent` in `Extension<TParent>` will always match. Hence the `as any`.
    if (extension && !this._parent?.extensions().has(extension as any)) {
      throw error(`Cannot mark field ${this.name} as part of the provided extension: it is not an extension of field parent type ${this.parent}`);
    }
    this._extension = extension;
    this.onModification();
  }

  isDeprecated(): boolean {
    return this.hasAppliedDirective('deprecated');
  }

  /**
   * Removes this field definition from its parent type.
   *
   * After calling this method, this field definition will be "detached": it wil have no parent, schema, type,
   * arguments or directives.
   */
  remove(): never[] {
    if (!this._parent) {
      return [];
    }
    this.onModification();
    InputObjectType.prototype['removeFieldInternal'].call(this._parent, this);
    this._parent = undefined;
    this.type = undefined;
    // Fields have nothing that can reference them outside of their parents
    return [];
  }

  toString(): string {
    const defaultStr = this.defaultValue === undefined ? "" : ` = ${valueToString(this.defaultValue, this.type)}`;
    return `${this.name}: ${this.type}${defaultStr}`;
  }
}

export class ArgumentDefinition<TParent extends FieldDefinition<any> | DirectiveDefinition> extends NamedSchemaElementWithType<InputType, ArgumentDefinition<TParent>, TParent, never> {
  readonly kind = 'ArgumentDefinition' as const;
  defaultValue?: any

  constructor(name: string) {
    super(name);
  }

  get coordinate(): string {
    const parent = this._parent;
    return `${parent == undefined ? '<detached>' : parent.coordinate}(${this.name}:)`;
  }

  isRequired(): boolean {
    return isNonNullType(this.type!) && this.defaultValue === undefined;
  }

  isDeprecated(): boolean {
    return this.hasAppliedDirective('deprecated');
  }

  /**
   * Removes this argument definition from its parent element (field or directive).
   *
   * After calling this method, this argument definition will be "detached": it wil have no parent, schema, type,
   * default value or directives.
   */
  remove(): never[] {
    if (!this._parent) {
      return [];
    }
    this.onModification();
    if (this._parent instanceof FieldDefinition) {
      FieldDefinition.prototype['removeArgumentInternal'].call(this._parent, this.name);
    } else {
      DirectiveDefinition.prototype['removeArgumentInternal'].call(this._parent, this.name);
    }
    this._parent = undefined;
    this.type = undefined;
    this.defaultValue = undefined;
    return [];
  }

  toString() {
    const defaultStr = this.defaultValue === undefined ? "" : ` = ${valueToString(this.defaultValue, this.type)}`;
    return `${this.name}: ${this.type}${defaultStr}`;
  }
}

export class EnumValue extends NamedSchemaElement<EnumValue, EnumType, never> {
  readonly kind = 'EnumValue' as const;
  private _extension?: Extension<EnumType>;

  get coordinate(): string {
    const parent = this._parent;
    return `${parent == undefined ? '<detached>' : parent.coordinate}.${this.name}`;
  }

  ofExtension(): Extension<EnumType> | undefined {
    return this._extension;
  }

  setOfExtension(extension: Extension<EnumType> | undefined) {
    this.checkUpdate();
    if (extension && !this._parent?.extensions().has(extension)) {
      throw error(`Cannot mark field ${this.name} as part of the provided extension: it is not an extension of field parent type ${this.parent}`);
    }
    this._extension = extension;
    this.onModification();
  }

  isDeprecated(): boolean {
    return this.hasAppliedDirective('deprecated');
  }

  /**
   * Removes this field definition from its parent type.
   *
   * After calling this method, this field definition will be "detached": it wil have no parent, schema, type,
   * arguments or directives.
   */
  remove(): never[] {
    if (!this._parent) {
      return [];
    }
    this.onModification();
    EnumType.prototype['removeValueInternal'].call(this._parent, this);
    this._parent = undefined;
    // Enum values have nothing that can reference them outside of their parents
    // TODO: that's actually only semi-true if you include arguments, because default values in args and concrete directive applications can
    //   indirectly refer to enum value. It's indirect though as we currently keep enum value as string in values. That said, it would
    //   probably be really nice to be able to known if an enum value is used or not, rather then removing it and not knowing if we broke
    //   something).
    return [];
  }

  protected removeTypeReference(type: NamedType) {
    assert(false, `Enum value ${this} can't reference other types; shouldn't be asked to remove reference to ${type}`);
  }

  toString(): string {
    return `${this.name}`;
  }
}

export class DirectiveDefinition<TApplicationArgs extends {[key: string]: any} = {[key: string]: any}> extends NamedSchemaElement<DirectiveDefinition<TApplicationArgs>, Schema, Directive> {
  readonly kind = 'DirectiveDefinition' as const;

  private readonly _args: MapWithCachedArrays<string, ArgumentDefinition<DirectiveDefinition>> = new MapWithCachedArrays();
  repeatable: boolean = false;
  private readonly _locations: DirectiveLocationEnum[] = [];
  private readonly _referencers: Set<Directive<SchemaElement<any, any>, TApplicationArgs>> = new Set();

  constructor(name: string, readonly isBuiltIn: boolean = false) {
    super(name);
  }

  get coordinate(): string {
    return `@${this.name}`;
  }

  arguments(): readonly ArgumentDefinition<DirectiveDefinition>[] {
    return this._args.values();
  }

  argument(name: string): ArgumentDefinition<DirectiveDefinition> | undefined {
    return this._args.get(name);
  }

  addArgument(arg: ArgumentDefinition<DirectiveDefinition>): ArgumentDefinition<DirectiveDefinition>;
  addArgument(name: string, type?: InputType, defaultValue?: any): ArgumentDefinition<DirectiveDefinition>;
  addArgument(nameOrArg: string | ArgumentDefinition<DirectiveDefinition>, type?: InputType, defaultValue?: any): ArgumentDefinition<DirectiveDefinition> {
    let toAdd: ArgumentDefinition<DirectiveDefinition>;
    if (typeof nameOrArg === 'string') {
      this.checkUpdate();
      toAdd = new ArgumentDefinition<DirectiveDefinition>(nameOrArg);
      toAdd.defaultValue = defaultValue;
    } else {
      this.checkUpdate(nameOrArg);
      toAdd = nameOrArg;
    }
    if (this.argument(toAdd.name)) {
      throw error(`Argument ${toAdd.name} already exists on field ${this.name}`);
    }
    this._args.set(toAdd.name, toAdd);
    Element.prototype['setParent'].call(toAdd, this);
    if (typeof nameOrArg === 'string') {
      toAdd.type = type;
    }
    this.onModification();
    return toAdd;
  }

  private removeArgumentInternal(name: string) {
    this._args.delete(name);
  }

  get locations(): readonly DirectiveLocationEnum[] {
    return this._locations;
  }

  addLocations(...locations: DirectiveLocationEnum[]): DirectiveDefinition {
    let modified = false;
    for (const location of locations) {
      if (!this._locations.includes(location)) {
        this._locations.push(location);
        modified = true;
      }
    }
    if (modified) {
      this.onModification();
    }
    return this;
  }

  addAllLocations(): DirectiveDefinition {
    return this.addLocations(...Object.values(DirectiveLocation));
  }

  addAllTypeLocations(): DirectiveDefinition {
    return this.addLocations('SCALAR', 'OBJECT', 'INTERFACE', 'UNION', 'ENUM', 'INPUT_OBJECT');
  }

  removeLocations(...locations: DirectiveLocationEnum[]): DirectiveDefinition {
    let modified = false;
    for (const location of locations) {
      const index = this._locations.indexOf(location);
      if (index >= 0) {
        this._locations.splice(index, 1);
        modified = true;
      }
    }
    if (modified) {
      this.onModification();
    }
    return this;
  }

  applications(): readonly Directive<SchemaElement<any, any>, TApplicationArgs>[] {
    return setValues(this._referencers);
  }

  private addReferencer(referencer: Directive<SchemaElement<any, any>, TApplicationArgs>) {
    assert(referencer, 'Referencer should exists');
    this._referencers.add(referencer);
  }

  private removeReferencer(referencer: Directive<SchemaElement<any, any>, TApplicationArgs>) {
    this._referencers.delete(referencer);
  }

  protected removeTypeReference(type: NamedType) {
    assert(false, `Directive definition ${this} can't reference other types (it's arguments can); shouldn't be asked to remove reference to ${type}`);
  }

  remove(): Directive[] {
    if (!this._parent) {
      return [];
    }
    this.onModification();
    Schema.prototype['removeDirectiveInternal'].call(this._parent, this);
    this._parent = undefined;
    assert(this._appliedDirectives.length === 0, "Directive definition should not have directive applied to it");
    for (const arg of this.arguments()) {
      arg.remove();
    }
    // Note that directive applications don't link directly to their definitions. Instead, we fetch
    // their definition from the schema when requested. So we don't have to do anything on the referencers
    // other than return them.
    const toReturn = setValues(this._referencers);
    this._referencers.clear();
    return toReturn;
  }

  toString(): string {
    return `@${this.name}`;
  }
}

export class Directive<
  TParent extends SchemaElement<any, any> | DirectiveTargetElement<any> = SchemaElement<any, any>,
  TArgs extends {[key: string]: any} = {[key: string]: any}
> extends Element<TParent> implements Named {
  // Note that _extension will only be set for directive directly applied to an extendable element. Meaning that if a directive is
  // applied to a field that is part of an extension, the field will have its extension set, but not the underlying directive.
  private _extension?: Extension<any>;

  constructor(readonly name: string, private _args: TArgs) {
    super();
  }

  schema(): Schema {
    return this.parent.schema();
  }

  get definition(): DirectiveDefinition | undefined {
    const doc = this.schema();
    return doc.directive(this.name);
  }

  arguments(includeDefaultValues: boolean = false) : Readonly<TArgs> {
    if (!includeDefaultValues) {
      return this._args;
    }
    const definition = this.definition;
    if (!definition) {
      throw error(`Cannot include default values for arguments: cannot find directive definition for ${this.name}`);
    }
    const updated = Object.create(null);
    for (const argDef of definition.arguments()) {
      updated[argDef.name] = withDefaultValues(this._args[argDef.name], argDef);
    }
    return updated;
  }

  private onModification() {
    if (this.isAttachedToSchemaElement()) {
      Schema.prototype['onModification'].call(this.schema());
    }
  }

  private isAttachedToSchemaElement(): boolean {
    return this.isAttached();
  }

  setArguments(args: TArgs) {
    this._args = args;
    this.onModification();
  }

  argumentType(name: string): InputType | undefined {
    return this.definition?.argument(name)?.type;
  }

  matchArguments(expectedArgs: Record<string, any>): boolean {
    const entries = Object.entries(this._args);
    if (entries.length !== Object.keys(expectedArgs).length) {
      return false;
    }
    for (const [key, val] of entries) {
      if (!(key in expectedArgs)) {
        return false;
      }
      const expectedVal = expectedArgs[key];
      if (!valueEquals(expectedVal, val)) {
        return false;
      }
    }
    return true;
  }

  ofExtension(): Extension<any> | undefined {
    return this._extension;
  }

  setOfExtension(extension: Extension<any> | undefined) {
    this.checkUpdate();
    if (extension) {
      const parent = this.parent;
      if (parent instanceof SchemaDefinition || parent instanceof BaseNamedType) {
        if (!parent.extensions().has(extension)) {
          throw error(`Cannot mark directive ${this.name} as part of the provided extension: it is not an extension of parent ${parent}`);
        }
      } else {
        throw error(`Can only mark directive parts of extensions when directly apply to type or schema definition.`);
      }
    }
    this._extension = extension;
    this.onModification();
  }

  argumentsToAST(): ArgumentNode[] | undefined {
    const entries = Object.entries(this._args);
    if (entries.length === 0) {
      return undefined;
    }

    const definition = this.definition;
    assert(definition, () => `Cannot convert arguments of detached directive ${this}`);
    return entries.map(([n, v]) => {
      return {
        kind: 'Argument',
        name: { kind: Kind.NAME, value: n },
        value: valueToAST(v, definition.argument(n)!.type!)!,
      };
    });
  }

  /**
   * Removes this directive application from its parent type.
   *
   * @returns whether the directive was actually removed, that is whether it had a parent.
   */
  remove(): boolean {
    if (!this._parent) {
      return false;
    }
    this.onModification();
    const coreFeatures = this.schema().coreFeatures;
    if (coreFeatures && this.name === coreFeatures.coreItself.nameInSchema) {
      // We're removing a @core directive application, so we remove it from the list of core features. And
      // if it is @core itself, we clean all features (to avoid having things too inconsistent).
      const url = FeatureUrl.parse(this._args['feature']!);
      if (url.identity === coreFeatures.coreItself.url.identity) {
        // Note that we unmark first because the loop after that will nuke our parent.
        Schema.prototype['unmarkAsCoreSchema'].call(this.schema());
        for (const d of this.schema().schemaDefinition.appliedDirectivesOf(coreFeatures.coreItself.nameInSchema)) {
          d.removeInternal();
        }
        // The loop above will already have call removeInternal on this instance, so we can return
        return true;
      } else {
        CoreFeatures.prototype['removeFeature'].call(coreFeatures, url.identity);
      }
    }
    return this.removeInternal();
  }

  private removeInternal(): boolean {
    if (!this._parent) {
      return false;
    }
    const definition = this.definition;
    if (definition && this.isAttachedToSchemaElement()) {
      DirectiveDefinition.prototype['removeReferencer'].call(definition, this as Directive<SchemaElement<any, any>>);
    }
    const parentDirectives = this._parent.appliedDirectives as Directive<TParent>[];
    const index = parentDirectives.indexOf(this);
    assert(index >= 0, () => `Directive ${this} lists ${this._parent} as parent, but that parent doesn't list it as applied directive`);
    parentDirectives.splice(index, 1);
    this._parent = undefined;
    this._extension = undefined;
    return true;
  }

  toString(): string {
    const entries = Object.entries(this._args).filter(([_, v]) => v !== undefined);
    const args = entries.length == 0 ? '' : '(' + entries.map(([n, v]) => `${n}: ${valueToString(v, this.argumentType(n))}`).join(', ') + ')';
    return `@${this.name}${args}`;
  }
}

export class Variable {
  constructor(readonly name: string) {}

  toVariableNode(): VariableNode {
    return {
      kind: 'Variable',
      name: { kind: 'Name', value: this.name },
    }
  }

  toString(): string {
    return '$' + this.name;
  }
}

export type Variables = readonly Variable[];

export function mergeVariables(v1s: Variables, v2s: Variables): Variables {
  if (v1s.length == 0) {
    return v2s;
  }
  if (v2s.length == 0) {
    return v1s;
  }
  const res: Variable[] = v1s.concat();
  for (const v of v2s) {
    if (!containsVariable(v1s, v)) {
      res.push(v);
    }
  }
  return res;
}

export function containsVariable(variables: Variables, toCheck: Variable): boolean {
  return variables.some(v => v.name == toCheck.name);
}

export function isVariable(v: any): v is Variable {
  return v instanceof Variable;
}

export function variablesInArguments(args: {[key: string]: any}): Variables {
  let variables: Variables = [];
  for (const value of Object.values(args)) {
    variables = mergeVariables(variables, variablesInValue(value));
  }
  return variables;
}

export class VariableDefinition extends DirectiveTargetElement<VariableDefinition> {
  constructor(
    schema: Schema,
    readonly variable: Variable,
    readonly type: InputType,
    readonly defaultValue?: any,
  ) {
    super(schema);
  }

  toVariableDefinitionNode(): VariableDefinitionNode {
    return {
      kind: 'VariableDefinition',
      variable: this.variable.toVariableNode(),
      type: typeToAST(this.type),
      defaultValue: valueToAST(this.defaultValue, this.type),
      directives: this.appliedDirectivesToDirectiveNodes()
    }
  }

  toString() {
    let base = this.variable + ': ' + this.type;
    if (this.defaultValue) {
      base = base + ' = ' + valueToString(this.defaultValue, this.type);
    }
    return base + this.appliedDirectivesToString();
  }
}

export class VariableDefinitions {
  private readonly _definitions: MapWithCachedArrays<string, VariableDefinition> = new MapWithCachedArrays();

  add(definition: VariableDefinition): boolean {
    if (this._definitions.has(definition.variable.name)) {
      return false;
    }
    this._definitions.set(definition.variable.name, definition);
    return true;
  }

  addAll(definitions: VariableDefinitions) {
    for (const definition of definitions._definitions.values()) {
      this.add(definition);
    }
  }

  definition(variable: Variable | string): VariableDefinition | undefined {
    const varName = typeof variable === 'string' ? variable : variable.name;
    return this._definitions.get(varName);
  }

  isEmpty(): boolean {
    return this._definitions.size === 0;
  }

  definitions(): readonly VariableDefinition[] {
    return this._definitions.values();
  }

  filter(variables: Variables): VariableDefinitions {
    if (variables.length === 0) {
      return new VariableDefinitions();
    }

    const newDefs = new VariableDefinitions();
    for (const variable of variables) {
      const def = this.definition(variable);
      if (!def) {
        throw new Error(`Cannot find variable ${variable} in definitions ${this}`);
      }
      newDefs.add(def);
    }
    return newDefs;
  }

  toVariableDefinitionNodes(): readonly VariableDefinitionNode[] | undefined {
    if (this._definitions.size === 0) {
      return undefined;
    }

    return this.definitions().map(def => def.toVariableDefinitionNode());
  }

  toString() {
    return '(' + this.definitions().join(', ') + ')';
  }
}

export function variableDefinitionsFromAST(schema: Schema, definitionNodes: readonly VariableDefinitionNode[]): VariableDefinitions {
  const definitions = new VariableDefinitions();
  for (const definitionNode of definitionNodes) {
    if (!definitions.add(variableDefinitionFromAST(schema, definitionNode))) {
      const name = definitionNode.variable.name.value;
      throw new GraphQLError(`Duplicate definition for variable ${name}`, definitionNodes.filter(n => n.variable.name.value === name));
    }
  }
  return definitions;
}

export function variableDefinitionFromAST(schema: Schema, definitionNode: VariableDefinitionNode): VariableDefinition {
  const variable = new Variable(definitionNode.variable.name.value);
  const type = typeFromAST(schema, definitionNode.type);
  if (!isInputType(type)) {
    throw new GraphQLError(`Invalid type "${type}" for variable $${variable}: not an input type`, definitionNode.type);
  }
  const def = new VariableDefinition(
    schema,
    variable,
    type,
    definitionNode.defaultValue ? valueFromAST(definitionNode.defaultValue, type) : undefined
  );
  return def;
}

export const graphQLBuiltIns = new BuiltIns();

function addReferenceToType(referencer: SchemaElement<any, any>, type: Type) {
  switch (type.kind) {
    case 'ListType':
      addReferenceToType(referencer, type.baseType());
      break;
    case 'NonNullType':
      addReferenceToType(referencer, type.baseType());
      break;
    default:
      BaseNamedType.prototype['addReferencer'].call(type, referencer);
      break;
  }
}

function removeReferenceToType(referencer: SchemaElement<any, any>, type: Type) {
  switch (type.kind) {
    case 'ListType':
      removeReferenceToType(referencer, type.baseType());
      break;
    case 'NonNullType':
      removeReferenceToType(referencer, type.baseType());
      break;
    default:
      BaseNamedType.prototype['removeReferencer'].call(type, referencer);
      break;
  }
}

export function newNamedType(kind: NamedTypeKind, name: string): NamedType {
  switch (kind) {
    case 'ScalarType':
      return new ScalarType(name);
    case 'ObjectType':
      return new ObjectType(name);
    case 'InterfaceType':
      return new InterfaceType(name);
    case 'UnionType':
      return new UnionType(name);
    case 'EnumType':
      return new EnumType(name);
    case 'InputObjectType':
      return new InputObjectType(name);
    default:
      assert(false, `Unhandled kind ${kind} for type ${name}`);
  }
}

function *typesToCopy(source: Schema, dest: Schema): Generator<NamedType, void, undefined>  {
  for (const type of source.builtInTypes()) {
    if (!type.isIntrospectionType() && !dest.type(type.name)?.isBuiltIn) {
      yield type;
    }
  }
  yield* source.types();
}

function *directivesToCopy(source: Schema, dest: Schema): Generator<DirectiveDefinition, void, undefined>  {
  for (const directive of source.builtInDirectives()) {
    if (!dest.directive(directive.name)?.isBuiltIn) {
      yield directive;
    }
  }
  yield* source.directives();
}

function copy(source: Schema, dest: Schema) {
  // We shallow copy types first so any future reference to any of them can be dereferenced.
  for (const type of typesToCopy(source, dest)) {
    dest.addType(newNamedType(type.kind, type.name));
  }
  for (const directive of directivesToCopy(source, dest)) {
    copyDirectiveDefinitionInner(directive, dest.addDirectiveDefinition(directive.name));
  }
  copySchemaDefinitionInner(source.schemaDefinition, dest.schemaDefinition);
  for (const type of typesToCopy(source, dest)) {
    copyNamedTypeInner(type, dest.type(type.name)!);
  }
}

function copyExtensions<T extends ExtendableElement>(source: T, dest: T): Map<Extension<T>, Extension<T>> {
  const extensionMap = new Map<Extension<T>, Extension<T>>();
  for (const sourceExtension of source.extensions()) {
    const destExtension = new Extension<T>();
    dest.addExtension(destExtension as any);
    extensionMap.set(sourceExtension as any, destExtension);
  }
  return extensionMap;
}

function copyOfExtension<T extends ExtendableElement>(
  extensionsMap: Map<Extension<T>, Extension<T>>,
  source: { ofExtension(): Extension<T> | undefined },
  dest: { setOfExtension(ext: Extension<T> | undefined):any }
) {
  const toCopy = source.ofExtension();
  if (toCopy) {
    dest.setOfExtension(extensionsMap.get(toCopy));
  }
}

function copySchemaDefinitionInner(source: SchemaDefinition, dest: SchemaDefinition) {
  const extensionsMap = copyExtensions(source, dest);
  for (const rootType of source.roots()) {
    copyOfExtension(extensionsMap, rootType, dest.setRoot(rootType.rootKind, rootType.type.name));
  }
  // Same as copyAppliedDirectives, but as the directive applies to the schema definition, we need to remember if the application
  // is for the extension or not.
  for (const directive of source.appliedDirectives) {
    copyOfExtension(extensionsMap, directive, dest.applyDirective(directive.name, { ...directive.arguments() }));
  }
  dest.description = source.description;
  dest.sourceAST = source.sourceAST;
}

function copyNamedTypeInner(source: NamedType, dest: NamedType) {
  const extensionsMap = copyExtensions(source, dest);
  // Same as copyAppliedDirectives, but as the directive applies to the type, we need to remember if the application
  // is for the extension or not.
  for (const directive of source.appliedDirectives) {
    copyOfExtension(extensionsMap, directive, dest.applyDirective(directive.name, { ...directive.arguments() }));
  }
  dest.description = source.description;
  dest.sourceAST = source.sourceAST;
  switch (source.kind) {
    case 'ObjectType':
    case 'InterfaceType':
      const destFieldBasedType = dest as FieldBasedType<any, any>;
      for (const sourceField of source.fields()) {
        const destField = destFieldBasedType.addField(new FieldDefinition(sourceField.name));
        copyOfExtension(extensionsMap, sourceField, destField);
        copyFieldDefinitionInner(sourceField, destField);
      }
      for (const sourceImpl of source.interfaceImplementations()) {
        const destImpl = destFieldBasedType.addImplementedInterface(sourceImpl.interface.name);
        copyOfExtension(extensionsMap, sourceImpl, destImpl);
      }
      break;
    case 'UnionType':
      const destUnionType = dest as UnionType;
      for (const sourceType of source.members()) {
        const destType = destUnionType.addType(sourceType.type.name);
        copyOfExtension(extensionsMap, sourceType, destType);
      }
      break;
    case 'EnumType':
      const destEnumType = dest as EnumType;
      for (const sourceValue of source.values) {
        const destValue = destEnumType.addValue(sourceValue.name);
        destValue.description = sourceValue.description;
        copyOfExtension(extensionsMap, sourceValue, destValue);
        copyAppliedDirectives(sourceValue, destValue);
      }
      break
    case 'InputObjectType':
      const destInputType = dest as InputObjectType;
      for (const sourceField of source.fields()) {
        const destField = destInputType.addField(new InputFieldDefinition(sourceField.name));
        copyOfExtension(extensionsMap, sourceField, destField);
        copyInputFieldDefinitionInner(sourceField, destField);
      }
  }
}

function copyAppliedDirectives(source: SchemaElement<any, any>, dest: SchemaElement<any, any>) {
  for (const directive of source.appliedDirectives) {
    dest.applyDirective(directive.name, { ...directive.arguments() });
  }
}

function copyFieldDefinitionInner<P extends ObjectType | InterfaceType>(source: FieldDefinition<P>, dest: FieldDefinition<P>) {
  const type = copyWrapperTypeOrTypeRef(source.type, dest.schema()) as OutputType;
  dest.type = type;
  for (const arg of source.arguments()) {
    const argType = copyWrapperTypeOrTypeRef(arg.type, dest.schema());
    copyArgumentDefinitionInner(arg, dest.addArgument(arg.name, argType as InputType));
  }
  copyAppliedDirectives(source, dest);
  dest.description = source.description;
  dest.sourceAST = source.sourceAST;
}

function copyInputFieldDefinitionInner(source: InputFieldDefinition, dest: InputFieldDefinition) {
  const type = copyWrapperTypeOrTypeRef(source.type, dest.schema()) as InputType;
  dest.type = type;
  dest.defaultValue = source.defaultValue;
  copyAppliedDirectives(source, dest);
  dest.description = source.description;
  dest.sourceAST = source.sourceAST;
}

function copyWrapperTypeOrTypeRef(source: Type | undefined, destParent: Schema): Type | undefined {
  if (!source) {
    return undefined;
  }
  switch (source.kind) {
    case 'ListType':
      return new ListType(copyWrapperTypeOrTypeRef(source.ofType, destParent)!);
    case 'NonNullType':
      return new NonNullType(copyWrapperTypeOrTypeRef(source.ofType, destParent)! as NullableType);
    default:
      return destParent.type(source.name)!;
  }
}

function copyArgumentDefinitionInner<P extends FieldDefinition<any> | DirectiveDefinition>(source: ArgumentDefinition<P>, dest: ArgumentDefinition<P>) {
  const type = copyWrapperTypeOrTypeRef(source.type, dest.schema()) as InputType;
  dest.type = type;
  dest.defaultValue = source.defaultValue;
  copyAppliedDirectives(source, dest);
  dest.description = source.description;
  dest.sourceAST = source.sourceAST;
}

function copyDirectiveDefinitionInner(source: DirectiveDefinition, dest: DirectiveDefinition) {
  for (const arg of source.arguments()) {
    const type = copyWrapperTypeOrTypeRef(arg.type, dest.schema());
    copyArgumentDefinitionInner(arg, dest.addArgument(arg.name, type as InputType));
  }
  dest.repeatable = source.repeatable;
  dest.addLocations(...source.locations);
  dest.sourceAST = source.sourceAST;
  dest.description = source.description;
}
