"use server";

import { createAdminClient, createSessionClient } from "@/lib/appwrite";
import { InputFile } from "node-appwrite/file";
import { appwriteConfig } from "@/lib/appwrite/config";
import { ID, Models, Query } from "node-appwrite";
import { constructFileUrl, getFileType, parseStringify } from "@/lib/utils";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/actions/user.actions";


const handleError = (error: unknown, message: string) => {
    throw error;
};


declare interface UploadFileProps {
    file: File;
    ownerId: string;
    accountId: string;
    path: string;
}

export const uploadFile = async ({ file, ownerId, accountId, path }: UploadFileProps) => {

    const { storage, databases } = await createAdminClient();
  
    try {

        const inputFile = InputFile.fromBuffer(file, file.name);
    
        const bucketFile = await storage.createFile(
            appwriteConfig.bucketId,
            ID.unique(),
            inputFile
        );
  
        const fileDocument = {
            type: getFileType(bucketFile.name).type,
            name: bucketFile.name,
            url: constructFileUrl(bucketFile.$id),
            extension: getFileType(bucketFile.name).extension,
            size: bucketFile.sizeOriginal,
            owner: ownerId,
            accountId,
            users: [],
            bucketFileId: bucketFile.$id
        };
  
        const newFile = await databases.createDocument(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            ID.unique(),
            fileDocument
        )
        .catch(async (error: unknown) => {
            await storage.deleteFile(appwriteConfig.bucketId, bucketFile.$id);
            handleError(error, "Failed to create file document");
        });
  
        revalidatePath(path);

        return parseStringify(newFile);

    } 
    catch (error) {
        handleError(error, "Failed to upload file");
    }

};


const createQueries = ( currentUser: Models.Document, types: string[], searchText: string, sort: string, limit?: number ) => {

    const queries = [
        Query.or([
            Query.equal("owner", [currentUser.$id]),
            Query.contains("users", [currentUser.email]),
        ])
    ];
  
    if (types.length > 0) queries.push(Query.equal("type", types));
    if (searchText) queries.push(Query.contains("name", searchText));
    if (limit) queries.push(Query.limit(limit));
  
    if (sort) {
      const [sortBy, orderBy] = sort.split("-");
      queries.push(orderBy === "asc" ? Query.orderAsc(sortBy) : Query.orderDesc(sortBy) );
    }
  
    return queries;

};


declare type FileType = "document" | "image" | "video" | "audio" | "other";

declare interface GetFilesProps {
    types: FileType[];
    searchText?: string;
    sort?: string;
    limit?: number;
}

export const getFiles = async ({ types = [], searchText = "", sort = "$createdAt-desc", limit }: GetFilesProps) => {

    const { databases } = await createAdminClient();
  
    try {
        const currentUser = await getCurrentUser();
    
        if (!currentUser) throw new Error("User not found");
    
        const queries = createQueries(currentUser, types, searchText, sort, limit);
    
        const files = await databases.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            queries
        );
    
        return parseStringify(files);
    } 
    catch (error) {
        handleError(error, "Failed to get files");
    }

};


declare interface RenameFileProps {
    fileId: string;
    name: string;
    extension: string;
    path: string;
}


export const renameFile = async ({ fileId, name, extension, path }: RenameFileProps) => {

    const { databases } = await createAdminClient();
  
    try {

      const newName = `${name}.${extension}`;

      const updatedFile = await databases.updateDocument(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            fileId,
            {
                name: newName
            }
      );

      revalidatePath(path);

      return parseStringify(updatedFile);

    } 
    catch (error) {
        handleError(error, "Failed to rename file");
    }

};
  

declare interface UpdateFileUsersProps {
    fileId: string;
    emails: string[];
    path: string;
}


export const updateFileUsers = async ({ fileId, emails, path }: UpdateFileUsersProps) => {

    const { databases } = await createAdminClient();
  
    try {

        const updatedFile = await databases.updateDocument(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            fileId,
            {
                users: emails
            }
        );
  
        revalidatePath(path);

        return parseStringify(updatedFile);

    } 
    catch (error) {
        handleError(error, "Failed to rename file");
    }

};
  

declare interface DeleteFileProps {
    fileId: string;
    bucketFileId: string;
    path: string;
}


export const deleteFile = async ({ fileId, bucketFileId, path }: DeleteFileProps) => {

    const { databases, storage } = await createAdminClient();
  
    try {
        const deletedFile = await databases.deleteDocument(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            fileId,
        );
  
        if (deletedFile) {
            await storage.deleteFile(appwriteConfig.bucketId, bucketFileId);
        }
  
        revalidatePath(path);

        return parseStringify({ status: "success" });

    } 
    catch (error) {
        handleError(error, "Failed to rename file");
    }

};
  


export async function getTotalSpaceUsed() {
    try {
        const { databases } = await createSessionClient();
        const currentUser = await getCurrentUser();
        if (!currentUser) throw new Error("User is not authenticated.");
    
        const files = await databases.listDocuments(
            appwriteConfig.databaseId,
            appwriteConfig.filesCollectionId,
            [Query.equal("owner", [currentUser.$id])]
        );
  
        const totalSpace = {
            image: { size: 0, latestDate: "" },
            document: { size: 0, latestDate: "" },
            video: { size: 0, latestDate: "" },
            audio: { size: 0, latestDate: "" },
            other: { size: 0, latestDate: "" },
            used: 0,
            all: 2 * 1024 * 1024 * 1024
        };
  
        files.documents.forEach((file) => {
            const fileType = file.type as FileType;

            totalSpace[fileType].size += file.size;
            totalSpace.used += file.size;
    
            if (!totalSpace[fileType].latestDate || new Date(file.$updatedAt) > new Date(totalSpace[fileType].latestDate)) {
                totalSpace[fileType].latestDate = file.$updatedAt;
            }
        });
  
        return parseStringify(totalSpace);

    } 
    catch (error) {
        handleError(error, "Error calculating total space used:, ");
    }
    
}